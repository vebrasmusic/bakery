import React from "react";
import { Box, Text } from "ink";
import { colors, statusColor } from "../theme.js";
import type { SlicePaneRow } from "../view-model.js";

export interface PieCardListProps {
  rows: SlicePaneRow[];
  focused: boolean;
  selectedIndex: number;
  scrollOffset: number;
  height: number;
  collapsedPieIds: Set<string>;
}

export function PieCardList({
  rows,
  focused,
  selectedIndex,
  scrollOffset,
  height,
  collapsedPieIds
}: PieCardListProps): React.ReactElement {
  const borderColor = focused ? colors.lemon : colors.peach;
  const contentHeight = Math.max(1, height - 3);
  const clampedOffset = Math.max(0, Math.min(scrollOffset, Math.max(0, rows.length - contentHeight)));
  const visibleRows = rows.slice(clampedOffset, clampedOffset + contentHeight);

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
        {"\uD83E\uDD67"} Pies / Slices {focused ? "(focused)" : ""}
      </Text>
      {visibleRows.length === 0 ? (
        <Text color={colors.dimmed} italic wrap="truncate-end">
          No pies yet! Focus this pane and press `c` to create one.
        </Text>
      ) : (
        visibleRows.map((row, index) => {
          const absoluteIndex = clampedOffset + index;
          const selected = absoluteIndex === selectedIndex;
          const indicator = selected ? ">" : " ";
          const indentation = "    ".repeat(row.depth);
          const color =
            row.rowType === "pie"
              ? colors.golden
              : row.status
                ? statusColor(row.status)
                : colors.cream;
          const rowPrefix =
            row.rowType === "pie"
              ? `${collapsedPieIds.has(row.id) ? "▸" : "▾"} ${row.id === "orphan-group" ? "⚠" : "🥧"}`
              : "🍰";

          return (
            <Text key={`${row.rowType}-${row.id}-${absoluteIndex}`} color={selected ? colors.lemon : color} wrap="truncate-end">
              {`${indicator} ${indentation}${rowPrefix} ${row.label}`}
            </Text>
          );
        })
      )}
    </Box>
  );
}
