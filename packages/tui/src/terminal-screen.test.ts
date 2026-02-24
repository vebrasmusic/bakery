import { describe, expect, it, vi } from "vitest";
import { enterAlternateScreen, exitAlternateScreen } from "./terminal-screen.js";

describe("terminal-screen", () => {
  it("writes enter alt-screen and hide cursor sequences", () => {
    const write = vi.fn();
    enterAlternateScreen({ write });
    expect(write).toHaveBeenNthCalledWith(1, "\u001B[?1049h");
    expect(write).toHaveBeenNthCalledWith(2, "\u001B[?25l");
  });

  it("writes show cursor and exit alt-screen sequences", () => {
    const write = vi.fn();
    exitAlternateScreen({ write });
    expect(write).toHaveBeenNthCalledWith(1, "\u001B[?25h");
    expect(write).toHaveBeenNthCalledWith(2, "\u001B[?1049l");
  });
});
