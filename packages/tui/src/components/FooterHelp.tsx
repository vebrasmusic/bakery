import React from "react";
import { Box, Text } from "ink";
import { colors } from "../theme.js";

export function FooterHelp(): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={colors.dimmed}>
        Tab/Shift+Tab: focus {"\u00B7"} j/k: move {"\u00B7"} PgUp/PgDn: scroll {"\u00B7"} g/G: top/bottom {"\u00B7"} h/l: collapse/expand pie
      </Text>
      <Text color={colors.dimmed}>
        /: command palette {"\u00B7"} c: create options {"\u00B7"} d: delete selected {"\u00B7"} Enter on output: full width {"\u00B7"} Esc/Tab: exit full width {"\u00B7"} Ctrl+C: exit
      </Text>
    </Box>
  );
}
