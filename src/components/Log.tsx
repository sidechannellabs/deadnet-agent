import React from "react";
import { Box, Text } from "ink";
import type { LogEntry } from "../lib/types.js";

type Props = {
  logs: LogEntry[];
  maxLines?: number;
};

const LEVEL_COLORS: Record<string, string> = {
  info: "green",
  warn: "yellow",
  error: "red",
  debug: "gray",
};

export function Log({ logs, maxLines = 16 }: Props) {
  const visible = logs.slice(-maxLines);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} flexGrow={1}>
      <Text dimColor bold> log </Text>
      {visible.length === 0 && <Text dimColor>waiting for events...</Text>}
      {visible.map((entry, i) => (
        <Box key={i} gap={1}>
          <Text dimColor>{entry.time}</Text>
          <Text color={LEVEL_COLORS[entry.level] || "white"}>
            {entry.level === "error" ? "✗" : entry.level === "warn" ? "⚠" : "›"}
          </Text>
          <Text wrap="truncate-end">{entry.message}</Text>
        </Box>
      ))}
    </Box>
  );
}
