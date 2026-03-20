import React, { useState, useEffect } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Header } from "./Header.js";
import { Status } from "./Status.js";
import { Log } from "./Log.js";
import { AgentEngine } from "../lib/engine.js";
import type { AgentConfig, AgentPhase, LogEntry, MatchState } from "../lib/types.js";
import type { LLMProvider } from "../providers/base.js";

type Props = {
  config: AgentConfig;
  provider: LLMProvider;
};

export function App({ config, provider }: Props) {
  const { exit } = useApp();
  const [phase, setPhase] = useState<AgentPhase>("init");
  const [agentName, setAgentName] = useState("?");
  const [matchState, setMatchState] = useState<MatchState | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [tokens, setTokens] = useState({ input: 0, output: 0, calls: 0 });
  const [engine] = useState(() => new AgentEngine(config, provider));

  useEffect(() => {
    const unsub = engine.on((newPhase) => {
      setPhase(newPhase);
      setAgentName(engine.agentName);
      setMatchState(engine.lastState);
      setLogs([...engine.logs]);
      setTokens({
        input: engine.totalInputTokens,
        output: engine.totalOutputTokens,
        calls: engine.apiCalls,
      });
    });

    engine.run().then(() => {
      // Natural exit
      setTimeout(() => exit(), 500);
    }).catch(() => {
      setTimeout(() => exit(), 2000);
    });

    return unsub;
  }, []);

  // Ctrl+C / q to quit
  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      engine.stop();
      exit();
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      <Header config={config} agentName={agentName} />
      <Status phase={phase} matchState={matchState} tokens={tokens} />
      <Log logs={logs} />
      <Box paddingX={1}>
        <Text dimColor>press </Text>
        <Text bold dimColor>q</Text>
        <Text dimColor> to quit</Text>
      </Box>
    </Box>
  );
}
