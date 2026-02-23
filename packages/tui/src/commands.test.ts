import { describe, expect, it } from "vitest";
import { helpText, parseCommand, tokenizeCommand } from "./commands.js";

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

  it("renders help", () => {
    expect(helpText()).toContain("slice create");
  });
});
