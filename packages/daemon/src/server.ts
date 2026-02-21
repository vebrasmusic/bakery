import { existsSync, statSync } from "node:fs";
import http from "node:http";
import express from "express";
import { ZodError } from "zod";
import { loadRuntimeConfig } from "./config.js";
import { createDatabase } from "./db.js";
import { BakeryRepository } from "./repos/repository.js";
import { SliceOrchestrator } from "./services/orchestrator.js";
import { PortAllocator } from "./services/portAllocator.js";
import { createRouterProxyServer } from "./services/routerProxy.js";
import { handleCreatePie, handleListPies } from "./services/pieHandlers.js";
import { handleCreateSlice, handleListSlices, handleRemoveSlice, handleStopSlice } from "./services/sliceHandlers.js";
import { buildStatusResponse } from "./services/status.js";

function assertPathExists(filePath: string, expectedType: "file" | "directory"): void {
  if (!existsSync(filePath)) {
    throw new Error(`Path does not exist: ${filePath}`);
  }
  const stat = statSync(filePath);
  if (expectedType === "file" && !stat.isFile()) {
    throw new Error(`Expected a file path: ${filePath}`);
  }
  if (expectedType === "directory" && !stat.isDirectory()) {
    throw new Error(`Expected a directory path: ${filePath}`);
  }
}

function sanitizeError(error: unknown): { message: string } {
  if (error instanceof ZodError) {
    return { message: error.issues.map((issue) => issue.message).join(", ") };
  }
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: "Unknown error" };
}

async function bindToFirstAvailablePort(candidates: number[], host: string, listener: http.RequestListener): Promise<http.Server> {
  for (const candidate of candidates) {
    const server = http.createServer(listener);

    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(candidate, host, () => resolve());
      });
      return server;
    } catch {
      server.close();
    }
  }

  const fallback = http.createServer(listener);
  try {
    await new Promise<void>((resolve, reject) => {
      fallback.once("error", reject);
      fallback.listen(0, host, () => resolve());
    });
    return fallback;
  } catch {
    fallback.close();
  }

  throw new Error(`Unable to bind router on host ${host}; candidates: ${candidates.join(",")},0`);
}

export interface DaemonInstance {
  server: http.Server;
  routerServer: http.Server;
  routerPort: number;
}

export async function createDaemon(): Promise<DaemonInstance> {
  const config = loadRuntimeConfig();
  const db = createDatabase(config.dbPath);

  let routerPort = config.routerPortCandidates[0] ?? 4080;
  const repo = new BakeryRepository(db, () => routerPort);

  const routerServer = await bindToFirstAvailablePort(config.routerPortCandidates, config.host, createRouterProxyServer(repo));
  const routerAddress = routerServer.address();
  if (!routerAddress || typeof routerAddress === "string") {
    throw new Error("Unable to determine router port");
  }
  routerPort = routerAddress.port;

  const allocator = new PortAllocator(config.portRangeStart, config.portRangeEnd);
  const orchestrator = new SliceOrchestrator(repo, allocator, {
    hostSuffix: config.hostSuffix,
    routerPortProvider: () => routerPort
  });

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: "Malformed JSON request body" });
      return;
    }
    next(error);
  });

  app.use((req, _res, next) => {
    const now = new Date().toISOString();
    process.stdout.write(`[${now}] ${req.method} ${req.path}\n`);
    next();
  });

  app.get("/v1/health", (_req, res) => {
    res.json({ status: "ok", port: config.port, routerPort });
  });

  app.get("/v1/status", (_req, res) => {
    const pies = repo.listPies();
    const slices = repo.listSlices({ all: true });
    res.json(
      buildStatusResponse({
        host: config.host,
        port: config.port,
        routerPort,
        pies,
        slices
      })
    );
  });

  app.get("/v1/pies", (_req, res) => {
    res.json(handleListPies(repo));
  });

  app.post("/v1/pies", (req, res) => {
    try {
      const pie = handleCreatePie(req.body, {
        repo,
        assertPathExists
      });

      res.status(201).json({ pie });
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed: pies.slug")) {
        res.status(409).json({ error: "Pie slug already exists. Choose a unique pie name." });
        return;
      }
      res.status(400).json({ error: sanitizeError(error).message });
    }
  });

  app.post("/v1/slices", async (req, res) => {
    try {
      const created = await handleCreateSlice(req.body, {
        repo,
        orchestrator
      });
      res.status(201).json({ slice: created });
    } catch (error) {
      if (error instanceof Error && error.message === "Pie not found") {
        res.status(404).json({ error: "Pie not found" });
        return;
      }
      res.status(400).json({ error: sanitizeError(error).message });
    }
  });

  app.get("/v1/slices", (req, res) => {
    const pieIdentifier = typeof req.query.pieId === "string" ? req.query.pieId : undefined;
    const allFlag = req.query.all === "true";

    try {
      const listInput = pieIdentifier !== undefined ? { pieIdentifier, allFlag } : { allFlag };
      const slices = handleListSlices(listInput, repo);
      res.json({ slices });
    } catch (error) {
      if (error instanceof Error && error.message === "Pie not found") {
        res.status(404).json({ error: "Pie not found" });
        return;
      }
      res.status(400).json({ error: sanitizeError(error).message });
    }
  });

  app.post("/v1/slices/:id/stop", async (req, res) => {
    try {
      await handleStopSlice(
        {
          sliceId: req.params.id
        },
        {
          repo,
          orchestrator
        }
      );
      res.json({ ok: true });
    } catch (error) {
      if (error instanceof Error && (error.message === "Slice not found" || error.message === "Pie not found")) {
        res.status(404).json({ error: error.message });
        return;
      }
      res.status(400).json({ error: sanitizeError(error).message });
    }
  });

  app.delete("/v1/slices/:id", async (req, res) => {
    try {
      await handleRemoveSlice(
        {
          sliceId: req.params.id
        },
        {
          repo,
          orchestrator
        }
      );
      res.json({ ok: true });
    } catch (error) {
      if (error instanceof Error && (error.message === "Slice not found" || error.message === "Pie not found")) {
        res.status(404).json({ error: error.message });
        return;
      }
      res.status(400).json({ error: sanitizeError(error).message });
    }
  });

  const server = await new Promise<http.Server>((resolve, reject) => {
    const instance = app.listen(config.port, config.host, () => resolve(instance));
    instance.once("error", reject);
  });

  process.stdout.write(`Bakery daemon listening on http://${config.host}:${config.port}\n`);
  process.stdout.write(`Bakery router listening on http://${config.host}:${routerPort}\n`);

  return {
    server,
    routerServer,
    routerPort
  };
}
