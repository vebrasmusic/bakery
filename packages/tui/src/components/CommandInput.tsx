import React from "react";
import { Box, Text } from "ink";
import { colors } from "../theme.js";

export interface PromptFieldInfo {
  label: string;
  defaultValue?: string;
}

export interface CommandInputProps {
  value: string;
  promptField: PromptFieldInfo | null;
  focused?: boolean;
}

export function CommandInput({ value, promptField, focused = false }: CommandInputProps): React.ReactElement {
  const isPromptMode = promptField !== null;
  const borderColor = isPromptMode || focused ? colors.lemon : colors.peach;

  const promptLabel = isPromptMode ? promptField.label : `\uD83E\uDD67 bakery>${focused ? " (focused)" : ""}`;
  const hintText = isPromptMode && promptField.defaultValue
    ? ` [${promptField.defaultValue}]`
    : "";

  return (
    <Box borderStyle="round" borderColor={borderColor} paddingX={1}>
      <Text color={colors.golden} bold>{promptLabel} </Text>
      <Text color={colors.cream}>{value}</Text>
      <Text color={colors.dimmed}>|</Text>
      {hintText && <Text color={colors.dimmed}>{hintText}</Text>}
    </Box>
  );
}
