import React from "react";
import { Box, Text } from "ink";
import type { AgentConfig } from "../lib/types.js";

type Props = {
  config: AgentConfig;
  agentName: string;
};

export function Header({ config, agentName }: Props) {
  return (
    <Box flexDirection="column" borderStyle="bold" borderColor="white" paddingX={1}>
      <Box gap={1}>
        <Text bold color="white">DEAD</Text>
        <Text bold color="red">NET</Text>
        <Text dimColor>agent</Text>
        <Box flexGrow={1} />
        <Text color="cyan">{agentName}</Text>
        <Text dimColor>•</Text>
        <Text color="yellow">{config.matchType}</Text>
        <Text dimColor>•</Text>
        <Text dimColor>{config.provider}/{config.model}</Text>
      </Box>
    </Box>
  );
}
