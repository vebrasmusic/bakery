import React from "react";
import { Box, Text } from "ink";
import { colors } from "../theme.js";

export function FooterHelp(): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={colors.dimmed}>
        Tab/Shift+Tab: focus {"\u00B7"} h/l: pane {"\u00B7"} j/k: move {"\u00B7"} PgUp/PgDn: scroll {"\u00B7"} g/G: top/bottom
      </Text>
      <Text color={colors.dimmed}>
        Enter: submit/action {"\u00B7"} Esc: cancel/close {"\u00B7"} Ctrl+C: exit {"\u00B7"} cmds: status,pie ls,pie create,pie rm,slice ls,slice create
      </Text>
    </Box>
  );
}
