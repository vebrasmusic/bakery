import React from "react";
import { Box, Text } from "ink";
import { colors } from "../theme.js";
import type { StatusSummary } from "../view-model.js";

export interface StatusBarProps {
  summary: StatusSummary | null;
}

export function StatusBar({ summary }: StatusBarProps): React.ReactElement {
  if (summary === null) {
    return (
      <Box borderStyle="round" borderColor={colors.peach} paddingX={1}>
        <Text color={colors.dimmed}>Loading status...</Text>
      </Box>
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor={colors.peach}
      paddingX={1}
      flexDirection="column"
    >
      <Box>
        <Text color={colors.golden} bold>{"\uD83C\uDF5E"} Status</Text>
      </Box>
      <Box gap={1}>
        <Text color={colors.cream}>
          daemon {summary.daemonHost}:{summary.daemonPort}
        </Text>
        <Text color={colors.dimmed}>{"\u00B7"}</Text>
        <Text color={colors.cream}>router {summary.routerPort}</Text>
      </Box>
      <Box gap={1}>
        <Text color={colors.golden}>{"\uD83E\uDD67"} pies {summary.totalPies}</Text>
        <Text color={colors.dimmed}>{"\u00B7"}</Text>
        <Text color={colors.golden}>{"\uD83D\uDD2A"} slices {summary.totalSlices}</Text>
        <Text color={colors.dimmed}>{"\u00B7"}</Text>
        <Text color={colors.mint}>{"\u2705"} {summary.running}</Text>
        <Text color={colors.lemon}>{"\uD83D\uDD04"} {summary.creating}</Text>
        <Text color={colors.dimmed}>{"\u23F9"} {summary.stopped}</Text>
        <Text color={colors.coral}>{"\u274C"} {summary.error}</Text>
      </Box>
    </Box>
  );
}
