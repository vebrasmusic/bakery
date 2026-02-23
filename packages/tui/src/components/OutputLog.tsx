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
  maxLines?: number;
}

const levelColorMap: Record<OutputLevel, string> = {
  info: colors.lavender,
  success: colors.mint,
  error: colors.coral,
};

export function OutputLog({ entries, maxLines = 8 }: OutputLogProps): React.ReactElement {
  const visibleEntries = entries.slice(-maxLines);

  return (
    <Box
      borderStyle="round"
      borderColor={colors.peach}
      paddingX={1}
      flexDirection="column"
    >
      <Text color={colors.golden} bold>{"\uD83D\uDCCB"} Output</Text>
      {visibleEntries.length === 0 ? (
        <Text color={colors.dimmed} italic>No output yet.</Text>
      ) : (
        visibleEntries.map((entry, index) => (
          <Box key={index} gap={1}>
            <Text color={colors.dimmed}>[{entry.timestamp}]</Text>
            <Text color={levelColorMap[entry.level]}>{entry.message}</Text>
          </Box>
        ))
      )}
    </Box>
  );
}
