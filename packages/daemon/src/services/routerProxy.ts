import http from "node:http";
import type { BakeryRepository } from "../repos/repository.js";

function normalizeHost(rawHostHeader: string | undefined): string {
  if (!rawHostHeader) {
    return "";
  }
  return rawHostHeader.split(":")[0]?.trim().toLowerCase() ?? "";
}

function copyHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const next: http.OutgoingHttpHeaders = { ...headers };
  delete next["host"];
  delete next["connection"];
  return next;
}

export function createRouterProxyServer(repo: BakeryRepository): http.RequestListener {
  return (req, res) => {
    const host = normalizeHost(req.headers.host);
    if (!host) {
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "Missing Host header" }));
      return;
    }

    const route = repo.getHostRoute(host);
    if (!route) {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: `No active route for host ${host}` }));
      return;
    }

    if (route.sliceStatus !== "running") {
      res.statusCode = 503;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "Slice is not active" }));
      return;
    }

    const upstream = http.request(
      {
        protocol: "http:",
        hostname: "127.0.0.1",
        port: route.port,
        method: req.method,
        path: req.url,
        headers: copyHeaders(req.headers)
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      }
    );

    upstream.on("error", (error) => {
      res.statusCode = 502;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: `Upstream connection failed: ${error.message}` }));
    });

    req.pipe(upstream);
  };
}
