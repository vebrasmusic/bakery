import type { WriteStream } from "node:tty";

const ENTER_ALT_SCREEN = "\u001B[?1049h";
const EXIT_ALT_SCREEN = "\u001B[?1049l";
const HIDE_CURSOR = "\u001B[?25l";
const SHOW_CURSOR = "\u001B[?25h";

export function enterAlternateScreen(stdout: Pick<WriteStream, "write">): void {
  stdout.write(ENTER_ALT_SCREEN);
  stdout.write(HIDE_CURSOR);
}

export function exitAlternateScreen(stdout: Pick<WriteStream, "write">): void {
  stdout.write(SHOW_CURSOR);
  stdout.write(EXIT_ALT_SCREEN);
}
