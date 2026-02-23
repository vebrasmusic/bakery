import React from "react";
import { Box, Text } from "ink";
import { colors, statusColor, statusDot } from "../theme.js";
import type { PieCardView } from "../view-model.js";

export interface PieCardProps {
  pie: PieCardView;
}

export function PieCard({ pie }: PieCardProps): React.ReactElement {
  return (
    <Box
      borderStyle="round"
      borderColor={colors.peach}
      paddingX={1}
      flexDirection="column"
    >
      <Box gap={1}>
        <Text color={colors.golden} bold>
          {"\uD83E\uDD67"} {pie.pieName}
        </Text>
        <Text color={colors.dimmed}>
          {pie.sliceCount} slice{pie.sliceCount !== 1 ? "s" : ""} {"\u00B7"} {pie.runningCount} running
        </Text>
      </Box>

      {pie.slices.length === 0 ? (
        <Text color={colors.dimmed} italic>
          no slices yet — use `slice create` to cut one!
        </Text>
      ) : (
        pie.slices.map((slice) => (
          <Box key={slice.sliceId} gap={1}>
            <Text color={statusColor(slice.status)}>
              {statusDot(slice.status)}
            </Text>
            <Text color={statusColor(slice.status)}>
              {slice.status.padEnd(8)}
            </Text>
            <Text color={colors.cream}>
              {slice.sliceId.length > 8
                ? slice.sliceId.slice(0, 8)
                : slice.sliceId.padEnd(8)}
            </Text>
            <Text color={colors.lavender}>
              {slice.host}
            </Text>
            <Text color={colors.dimmed}>
              {slice.resources}
            </Text>
          </Box>
        ))
      )}
    </Box>
  );
}
