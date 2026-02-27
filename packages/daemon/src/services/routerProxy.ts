import http from "node:http";
import type { BakeryRepository } from "../repos/repository.js";

function normalizeHost(rawHostHeader: string | undefined): string {
  if (!rawHostHeader) {
    return "";
  }
  return rawHostHeader.split(":")[0]?.trim().toLowerCase() ?? "";
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return undefined;
}

function normalizeForwardedProto(rawProtoHeader: string | undefined): string {
  const normalized = rawProtoHeader
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  return normalized || "http";
}

function parsePortFromHostHeader(rawHostHeader: string): string | undefined {
  const hostHeader = rawHostHeader.trim();
  const ipv6Match = /^\[[^\]]+\]:(\d+)$/.exec(hostHeader);
  if (ipv6Match?.[1]) {
    return ipv6Match[1];
  }

  const colonCount = hostHeader.split(":").length - 1;
  if (colonCount !== 1) {
    return undefined;
  }

  const candidatePort = hostHeader.split(":")[1]?.trim();
  if (!candidatePort || !/^\d+$/.test(candidatePort)) {
    return undefined;
  }
  return candidatePort;
}

function appendForwardedFor(existingForwardedFor: string | undefined, remoteAddress: string | undefined): string | undefined {
  if (!existingForwardedFor) {
    return remoteAddress;
  }
  if (!remoteAddress) {
    return existingForwardedFor;
  }
  return `${existingForwardedFor}, ${remoteAddress}`;
}

function copyHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const next: http.OutgoingHttpHeaders = { ...headers };
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
        headers: (() => {
          const forwardedHeaders = copyHeaders(req.headers);
          const incomingHostHeader = firstHeaderValue(req.headers.host);
          const incomingProtoHeader = firstHeaderValue(req.headers["x-forwarded-proto"]);
          const incomingForwardedFor = firstHeaderValue(req.headers["x-forwarded-for"]);
          const forwardedProto = normalizeForwardedProto(incomingProtoHeader);
          const forwardedPort =
            (incomingHostHeader ? parsePortFromHostHeader(incomingHostHeader) : undefined) ??
            (forwardedProto === "https" ? "443" : "80");
          const forwardedFor = appendForwardedFor(incomingForwardedFor, req.socket.remoteAddress);

          if (incomingHostHeader) {
            forwardedHeaders["x-forwarded-host"] = incomingHostHeader;
          }
          forwardedHeaders["x-forwarded-proto"] = forwardedProto;
          forwardedHeaders["x-forwarded-port"] = forwardedPort;
          if (forwardedFor) {
            forwardedHeaders["x-forwarded-for"] = forwardedFor;
          }
          return forwardedHeaders;
        })()
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
