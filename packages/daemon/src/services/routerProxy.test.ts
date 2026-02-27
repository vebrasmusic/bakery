import http from "node:http";
import net from "node:net";
import { describe, expect, it } from "vitest";
import type { BakeryRepository, HostRoute } from "../repos/repository.js";
import { createRouterProxyServer } from "./routerProxy.js";

interface HttpResponseSnapshot {
  statusCode: number;
  body: string;
}

async function startServer(listener: http.RequestListener): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(listener);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine server port");
  }

  return { server, port: address.port };
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function sendRequest(input: {
  port: number;
  headers?: http.OutgoingHttpHeaders;
  setHost?: boolean;
}): Promise<HttpResponseSnapshot> {
  return await new Promise<HttpResponseSnapshot>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const request = http.request(
      {
        host: "127.0.0.1",
        port: input.port,
        method: "GET",
        path: "/",
        headers: input.headers,
        setHost: input.setHost
      },
      (response) => {
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );

    request.on("error", reject);
    request.end();
  });
}

function createRepo(route: HostRoute | null): BakeryRepository {
  return {
    getHostRoute: () => route
  } as unknown as BakeryRepository;
}

async function sendHttp10RequestWithoutHost(port: number): Promise<HttpResponseSnapshot> {
  return await new Promise<HttpResponseSnapshot>((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
      socket.write("GET / HTTP/1.0\r\n\r\n");
    });

    let rawResponse = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      rawResponse += chunk;
    });
    socket.on("error", reject);
    socket.on("end", () => {
      const [head = "", body = ""] = rawResponse.split("\r\n\r\n");
      const statusLine = head.split("\r\n")[0] ?? "";
      const statusCode = Number(statusLine.split(" ")[1] ?? 0);
      resolve({ statusCode, body });
    });
  });
}

describe("routerProxy", () => {
  it("returns 400 when host header is missing", async () => {
    const { server, port } = await startServer(createRouterProxyServer(createRepo(null)));
    try {
      const response = await sendHttp10RequestWithoutHost(port);
      expect(response.statusCode).toBe(400);
      expect(response.body).toContain("Missing Host header");
    } finally {
      await closeServer(server);
    }
  });

  it("returns 404 when route is missing", async () => {
    const { server, port } = await startServer(createRouterProxyServer(createRepo(null)));
    try {
      const response = await sendRequest({ port, headers: { host: "missing-s1.localtest.me:4080" } });
      expect(response.statusCode).toBe(404);
      expect(response.body).toContain("No active route for host missing-s1.localtest.me");
    } finally {
      await closeServer(server);
    }
  });

  it("returns 503 when route exists but slice is not running", async () => {
    const route: HostRoute = {
      host: "my-pie-s1.localtest.me",
      port: 30001,
      sliceId: "slice-1",
      pieId: "pie-1",
      sliceStatus: "stopped"
    };
    const { server, port } = await startServer(createRouterProxyServer(createRepo(route)));
    try {
      const response = await sendRequest({ port, headers: { host: "my-pie-s1.localtest.me:4080" } });
      expect(response.statusCode).toBe(503);
      expect(response.body).toContain("Slice is not active");
    } finally {
      await closeServer(server);
    }
  });

  it("forwards original host and standard x-forwarded headers", async () => {
    const upstream = await startServer((req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(req.headers));
    });
    const route: HostRoute = {
      host: "my-pie-s1.localtest.me",
      port: upstream.port,
      sliceId: "slice-1",
      pieId: "pie-1",
      sliceStatus: "running"
    };
    const router = await startServer(createRouterProxyServer(createRepo(route)));

    try {
      const response = await sendRequest({ port: router.port, headers: { host: "my-pie-s1.localtest.me:4080" } });
      const forwardedHeaders = JSON.parse(response.body) as Record<string, string | undefined>;

      expect(response.statusCode).toBe(200);
      expect(forwardedHeaders.host).toBe("my-pie-s1.localtest.me:4080");
      expect(forwardedHeaders["x-forwarded-host"]).toBe("my-pie-s1.localtest.me:4080");
      expect(forwardedHeaders["x-forwarded-proto"]).toBe("http");
      expect(forwardedHeaders["x-forwarded-port"]).toBe("4080");
      expect(forwardedHeaders["x-forwarded-for"]).toBeTruthy();
    } finally {
      await closeServer(router.server);
      await closeServer(upstream.server);
    }
  });

  it("appends x-forwarded-for and derives x-forwarded-port from proto when host has no port", async () => {
    const upstream = await startServer((req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(req.headers));
    });
    const route: HostRoute = {
      host: "my-pie-s1.localtest.me",
      port: upstream.port,
      sliceId: "slice-1",
      pieId: "pie-1",
      sliceStatus: "running"
    };
    const router = await startServer(createRouterProxyServer(createRepo(route)));

    try {
      const response = await sendRequest({
        port: router.port,
        headers: {
          host: "my-pie-s1.localtest.me",
          "x-forwarded-proto": "https",
          "x-forwarded-for": "203.0.113.10"
        }
      });
      const forwardedHeaders = JSON.parse(response.body) as Record<string, string | undefined>;

      expect(response.statusCode).toBe(200);
      expect(forwardedHeaders["x-forwarded-proto"]).toBe("https");
      expect(forwardedHeaders["x-forwarded-port"]).toBe("443");
      expect(forwardedHeaders["x-forwarded-for"]).toMatch(/^203\.0\.113\.10,\s+/);
    } finally {
      await closeServer(router.server);
      await closeServer(upstream.server);
    }
  });
});
