import React from "react";
import { Box, Text } from "ink";
import { colors } from "../theme.js";

export function FooterHelp(): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={colors.dimmed}>
        Enter: submit {"\u00B7"} Esc: cancel {"\u00B7"} Ctrl+C: exit
      </Text>
      <Text color={colors.dimmed}>
        cmds: status {"\u00B7"} pie ls {"\u00B7"} pie create {"\u00B7"} slice ls {"\u00B7"} slice create
      </Text>
    </Box>
  );
}
