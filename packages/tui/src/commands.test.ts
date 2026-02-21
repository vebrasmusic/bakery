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
    expect(parseCommand("slice create app . main web:http:primary,db:tcp:none")).toEqual({
      kind: "slice-create",
      pieId: "app",
      worktreePath: ".",
      branch: "main",
      resources: ["web:http:primary", "db:tcp:none"]
    });
  });

  it("renders help", () => {
    expect(helpText()).toContain("slice create");
  });
});
