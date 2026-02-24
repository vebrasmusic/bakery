import { describe, expect, it, vi } from "vitest";
import { executeCommand, helpText, parseCommand, tokenizeCommand } from "./commands.js";

describe("commands", () => {
  it("tokenizes quoted command", () => {
    expect(tokenizeCommand('pie create "my app" ~/repo')).toEqual(["pie", "create", "my app", "~/repo"]);
  });

  it("parses pie create prompt mode", () => {
    expect(parseCommand("pie create")).toEqual({ kind: "pie-create-prompt" });
  });

  it("parses non-interactive slice create", () => {
    expect(parseCommand("slice create app . main 3")).toEqual({
      kind: "slice-create",
      pieId: "app",
      worktreePath: ".",
      branch: "main",
      numResources: 3
    });
  });

  it("parses non-interactive slice create with --numresources flag", () => {
    expect(parseCommand("slice create app . main --numresources 4")).toEqual({
      kind: "slice-create",
      pieId: "app",
      worktreePath: ".",
      branch: "main",
      numResources: 4
    });
  });

  it("parses pie rm", () => {
    expect(parseCommand("pie rm app")).toEqual({ kind: "pie-rm", id: "app" });
  });

  it("renders help", () => {
    expect(helpText()).toContain("slice create");
    expect(helpText()).toContain("pie rm <id-or-slug>");
  });

  it("emits canonical JSON for non-interactive slice create", async () => {
    const api = {
      fetchStatus: vi.fn(),
      listPies: vi.fn(),
      createPie: vi.fn(),
      removePie: vi.fn(),
      listSlices: vi.fn(),
      createSlice: vi.fn().mockResolvedValue({
        slice: {
          id: "s2",
          pieId: "p1",
          ordinal: 2,
          host: "new-s1.localtest.me",
          worktreePath: "/tmp/new",
          branch: "main",
          status: "running",
          createdAt: "2026-02-20T00:10:00.000Z",
          stoppedAt: null,
          pieSlug: "my-app",
          routerPort: 4080,
          resources: [
            {
              key: "r1",
              protocol: "http",
              expose: "primary",
              allocatedPort: 30010,
              routeHost: "new-s1.localtest.me",
              routeUrl: "http://new-s1.localtest.me:4080"
            },
            {
              key: "r2",
              protocol: "tcp",
              expose: "none",
              allocatedPort: 30011
            }
          ]
        }
      }),
      stopSlice: vi.fn(),
      removeSlice: vi.fn()
    };

    const result = await executeCommand(
      { kind: "slice-create", pieId: "my-app", worktreePath: ".", branch: "main", numResources: 2 },
      api
    );

    expect(result.refresh).toBe(true);
    expect(result.output).toContain("Created slice s2 (new-s1.localtest.me)");
    expect(result.output).toContain("\"allocatedPorts\": [");
    expect(result.output).toContain("\"url\": \"http://new-s1.localtest.me:4080\"");
  });
});
