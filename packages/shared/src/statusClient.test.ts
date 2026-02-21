import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DAEMON_URL, fetchDaemonStatus, resolveDaemonUrl } from "./statusClient.js";

describe("resolveDaemonUrl", () => {
  it("defaults to local daemon url", () => {
    expect(resolveDaemonUrl(undefined)).toBe(DEFAULT_DAEMON_URL);
  });

  it("normalizes trailing slash", () => {
    expect(resolveDaemonUrl("http://127.0.0.1:47123/")).toBe("http://127.0.0.1:47123");
  });
});

describe("fetchDaemonStatus", () => {
  it("returns parsed status payload", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          daemon: { status: "ok", host: "127.0.0.1", port: 47123, routerPort: 4080 },
          pies: { total: 1 },
          slices: {
            total: 2,
            byStatus: { creating: 0, running: 1, stopped: 1, error: 0 },
            byPie: [{ pieId: "p1", pieName: "Alpha", pieSlug: "alpha", total: 2, running: 1 }]
          },
          generatedAt: "2026-02-20T00:00:00.000Z"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const status = await fetchDaemonStatus({ daemonUrl: "http://127.0.0.1:47123", fetchImpl });
    expect(status.daemon.status).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:47123/v1/status", {
      headers: { accept: "application/json" }
    });
  });

  it("throws with response details on non-200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 500, statusText: "ERR" }));
    await expect(fetchDaemonStatus({ fetchImpl })).rejects.toThrow("Status request failed (500): boom");
  });
});
