import { describe, expect, it, vi } from "vitest";
import { createPie, createSlice, listPies, listSlices, removeSlice, stopSlice } from "./daemonClient.js";

describe("daemonClient", () => {
  it("lists pies", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          pies: [
            {
              id: "p1",
              name: "Pie One",
              slug: "pie-one",
              repoPath: "/tmp/repo",
              createdAt: "2026-02-20T00:00:00.000Z"
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const response = await listPies({ daemonUrl: "http://127.0.0.1:47123", fetchImpl });
    expect(response.pies).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:47123/v1/pies", {
      method: "GET",
      headers: { accept: "application/json" }
    });
  });

  it("creates pie without extra headers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          pie: {
            id: "p1",
            name: "Pie One",
            slug: "pie-one",
            repoPath: "/tmp/repo",
            createdAt: "2026-02-20T00:00:00.000Z"
          }
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      )
    );

    await createPie(
      {
        name: "Pie One",
        repoPath: "/tmp/repo"
      },
      { daemonUrl: "http://127.0.0.1:47123", fetchImpl }
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:47123/v1/pies",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json"
        })
      })
    );
  });

  it("lists slices with pie scope", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          slices: [
            {
              id: "s1",
              pieId: "p1",
              ordinal: 1,
              host: "pie-s1.localtest.me",
              worktreePath: "/tmp/worktree",
              branch: "main",
              status: "running",
              createdAt: "2026-02-20T00:00:00.000Z",
              stoppedAt: null,
              resources: [
                {
                  key: "web",
                  protocol: "http",
                  expose: "primary",
                  allocatedPort: 5100,
                  routeHost: "pie-s1.localtest.me",
                  routeUrl: "http://pie-s1.localtest.me:4080"
                }
              ]
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const response = await listSlices({ pieId: "pie-one" }, { daemonUrl: "http://127.0.0.1:47123", fetchImpl });
    expect(response.slices).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:47123/v1/slices?pieId=pie-one", {
      method: "GET",
      headers: { accept: "application/json" }
    });
  });

  it("creates and mutates slice endpoints without extra headers", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            slice: {
              id: "s1",
              pieId: "p1",
              ordinal: 1,
              host: "pie-s1.localtest.me",
              worktreePath: "/tmp/worktree",
              branch: "main",
              status: "running",
              createdAt: "2026-02-20T00:00:00.000Z",
              stoppedAt: null,
              resources: [
                {
                  key: "web",
                  protocol: "http",
                  expose: "primary",
                  allocatedPort: 5100,
                  routeHost: "pie-s1.localtest.me",
                  routeUrl: "http://pie-s1.localtest.me:4080"
                }
              ],
              pieSlug: "pie-one",
              routerPort: 4080
            }
          }),
          { status: 201, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })
      );

    await createSlice(
      {
        pieId: "pie-one",
        worktreePath: "/tmp/worktree",
        branch: "main",
        resources: [{ key: "web", protocol: "http", expose: "primary" }]
      },
      {
        daemonUrl: "http://127.0.0.1:47123",
        fetchImpl
      }
    );
    await stopSlice("slice-1", { daemonUrl: "http://127.0.0.1:47123", fetchImpl });
    await removeSlice("slice-1", { daemonUrl: "http://127.0.0.1:47123", fetchImpl });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:47123/v1/slices",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "content-type": "application/json" })
      })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:47123/v1/slices/slice-1/stop",
      expect.objectContaining({
        method: "POST"
      })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:47123/v1/slices/slice-1",
      expect.objectContaining({
        method: "DELETE"
      })
    );
  });
});
