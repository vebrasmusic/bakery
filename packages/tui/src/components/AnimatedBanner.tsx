import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { colors } from "../theme.js";

const pieArt: string[] = [
  "⠀⢀⣠⣴⣲⣾⣿⣷⣶⣶⣄",
  "⣰⣿⣿⣿⣿⣿⣟⣿⣿⣿⣿⣷⡄",
  "⣿⣿⣿⣿⣿⣿⣵⣳⢟⢿⣝⣽⡿",
  "⠈⢿⣿⣞⣿⣯⣾⣾⣿⣿⣿⡿⠁",
  "⠀⠈⠳⢭⣉⡛⠛⢛⣋⡿⠞⠁",
  "⠀⠀⠀⠀⠀⠉⠉⠉",
];

// Steam: ( and ) drift upward and oscillate sideways above the pie
const STEAM_HEIGHT = 4;
const NUM_FRAMES = 6;

interface SteamParticle {
  character: string;
  column: number;
  row: number;
}

const STEAM_SEEDS: Array<{ character: string; baseColumn: number; baseRow: number }> = [
  { character: ")", baseColumn: 6,  baseRow: 0 },
  { character: "(", baseColumn: 4,  baseRow: 1 },
  { character: ")", baseColumn: 9,  baseRow: 1 },
  { character: "(", baseColumn: 6,  baseRow: 2 },
  { character: ")", baseColumn: 3,  baseRow: 3 },
  { character: "(", baseColumn: 9,  baseRow: 3 },
];

function buildSteamFrames(): string[][] {
  const lineWidth = 14;
  const frames: string[][] = [];

  for (let frameIndex = 0; frameIndex < NUM_FRAMES; frameIndex++) {
    const particles: SteamParticle[] = [];

    for (const seed of STEAM_SEEDS) {
      const row = ((seed.baseRow - frameIndex) % STEAM_HEIGHT + STEAM_HEIGHT) % STEAM_HEIGHT;
      const wobble = Math.round(Math.sin((frameIndex + seed.baseColumn) * 0.9) * 1.5);
      const column = Math.max(0, Math.min(seed.baseColumn + wobble, lineWidth - 1));
      particles.push({ character: seed.character, column, row });
    }

    const lines: string[] = [];
    for (let row = 0; row < STEAM_HEIGHT; row++) {
      const lineCharacters = Array.from<string>({ length: lineWidth }).fill(" ");
      for (const particle of particles) {
        if (particle.row === row) {
          lineCharacters[particle.column] = particle.character;
        }
      }
      lines.push(lineCharacters.join(""));
    }
    frames.push(lines);
  }

  return frames;
}

const steamFrames: string[][] = buildSteamFrames();

export interface AnimatedBannerProps {
  daemonUrl: string;
}

// Title text beside the middle rows of the pie
const TITLE_ROW = 1;
const SUBTITLE_ROW = 2;
const URL_ROW = 3;

export function AnimatedBanner({ daemonUrl }: AnimatedBannerProps): React.ReactElement {
  const [frameIndex, setFrameIndex] = useState<number>(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrameIndex((previous) => (previous + 1) % steamFrames.length);
    }, 400);
    return () => clearInterval(timer);
  }, []);

  const currentSteam = steamFrames[frameIndex]!;

  return (
    <Box flexDirection="column" paddingX={1}>
      {currentSteam.map((line, index) => (
        <Text key={`steam-${index}`} color={colors.dimmed} dimColor>{line}</Text>
      ))}
      {pieArt.map((line, index) => (
        <Box key={`pie-${index}`}>
          <Text color={colors.peach}>{line}</Text>
          {index === TITLE_ROW && (
            <Text color={colors.golden} bold>  {"\u2726"} B A K E R Y {"\u2726"}</Text>
          )}
          {index === SUBTITLE_ROW && (
            <Text color={colors.cream}>  Control Board</Text>
          )}
          {index === URL_ROW && (
            <Text color={colors.dimmed}>  {daemonUrl}</Text>
          )}
        </Box>
      ))}
    </Box>
  );
}
