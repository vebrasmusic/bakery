import type { SliceStatus } from "@bakery/shared";

export const colors = {
  golden: "#fbbf24",
  peach: "#fb923c",
  pink: "#f472b6",
  cream: "#fde68a",
  coral: "#fb7185",
  mint: "#86efac",
  lemon: "#fde047",
  lavender: "#c4b5fd",
  dimmed: "#a3a3a3",
} as const;

export type ColorName = keyof typeof colors;

const statusColorMap: Record<SliceStatus, string> = {
  running: colors.mint,
  creating: colors.lemon,
  stopped: colors.dimmed,
  error: colors.coral,
};

export function statusColor(status: SliceStatus): string {
  return statusColorMap[status];
}

const statusDotMap: Record<SliceStatus, string> = {
  running: "\u25CF",
  creating: "\u25CF",
  stopped: "\u25CB",
  error: "\u25CF",
};

export function statusDot(status: SliceStatus): string {
  return statusDotMap[status];
}
