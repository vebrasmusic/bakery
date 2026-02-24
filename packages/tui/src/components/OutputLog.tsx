import React from "react";
import { Box, Text } from "ink";
import { colors } from "../theme.js";

export type OutputLevel = "info" | "success" | "error";

export interface OutputEntry {
  timestamp: string;
  message: string;
  level: OutputLevel;
}

export interface OutputLogProps {
  entries: OutputEntry[];
  height: number;
  scrollOffset: number;
  focused: boolean;
}

const levelColorMap: Record<OutputLevel, string> = {
  info: colors.lavender,
  success: colors.mint,
  error: colors.coral,
};

export interface OutputLine {
  level: OutputLevel;
  text: string;
}

export function flattenOutputEntries(entries: OutputEntry[]): OutputLine[] {
  return entries.flatMap((entry) => {
    const lines = entry.message.split("\n");
    return lines.map((line, index) => ({
      level: entry.level,
      text: index === 0 ? `[${entry.timestamp}] ${line}` : `${" ".repeat(entry.timestamp.length + 3)}${line}`
    }));
  });
}

export function OutputLog({ entries, height, scrollOffset, focused }: OutputLogProps): React.ReactElement {
  const lines = flattenOutputEntries(entries);
  const contentHeight = Math.max(1, height - 3);
  const clampedOffset = Math.max(0, Math.min(scrollOffset, Math.max(0, lines.length - contentHeight)));
  const visibleLines = lines.slice(clampedOffset, clampedOffset + contentHeight);
  const borderColor = focused ? colors.lemon : colors.peach;

  return (
    <Box
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
      flexDirection="column"
      height={Math.max(3, height)}
      width="100%"
      overflow="hidden"
    >
      <Text color={colors.golden} bold>
        {"\uD83D\uDCCB"} Output {focused ? "(focused)" : ""}
      </Text>
      {visibleLines.length === 0 ? (
        <Text color={colors.dimmed} italic wrap="truncate-end">
          No output yet.
        </Text>
      ) : (
        visibleLines.map((line, index) => (
          <Text key={`${clampedOffset}-${index}`} color={levelColorMap[line.level]} wrap="truncate-end">
            {line.text}
          </Text>
        ))
      )}
    </Box>
  );
}
