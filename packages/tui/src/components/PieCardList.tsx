import React from "react";
import { Box, Text } from "ink";
import { colors, statusColor, statusDot } from "../theme.js";
import type { DashboardViewModel } from "../view-model.js";
import { PieCard } from "./PieCard.js";

export interface PieCardListProps {
  viewModel: DashboardViewModel;
}

export function PieCardList({ viewModel }: PieCardListProps): React.ReactElement {
  if (viewModel.pieCards.length === 0 && viewModel.orphanSlices.length === 0) {
    return (
      <Box paddingX={1}>
        <Text color={colors.dimmed} italic>
          No pies yet! Use `pie create` to start baking.
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {viewModel.pieCards.map((pie) => (
        <PieCard key={pie.pieId} pie={pie} />
      ))}

      {viewModel.orphanSlices.length > 0 && (
        <Box
          borderStyle="round"
          borderColor={colors.coral}
          paddingX={1}
          flexDirection="column"
        >
          <Text color={colors.coral} bold>Orphan Slices</Text>
          {viewModel.orphanSlices.map((slice) => (
            <Box key={slice.sliceId} gap={1}>
              <Text color={statusColor(slice.status)}>
                {statusDot(slice.status)}
              </Text>
              <Text color={statusColor(slice.status)}>
                {slice.status.padEnd(8)}
              </Text>
              <Text color={colors.cream}>{slice.sliceId}</Text>
              <Text color={colors.lavender}>{slice.host}</Text>
              <Text color={colors.dimmed}>{slice.resources}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
