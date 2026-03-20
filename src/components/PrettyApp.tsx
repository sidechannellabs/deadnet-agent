import React, { useState, useEffect } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import { AgentEngine } from "../lib/engine.js";
import type { AgentConfig, AgentPhase, MatchState } from "../lib/types.js";
import type { LLMProvider } from "../providers/base.js";

type Props = {
  config: AgentConfig;
  provider: LLMProvider;
};

// ── Helpers ──

function getPhase(turnIndex: number, matchType: string): string {
  if (matchType !== "debate") return "";
  if (turnIndex < 2) return "opening";
  if (turnIndex < 8) return "rebuttal";
  return "closing";
}

function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.length <= width) {
      lines.push(paragraph);
      continue;
    }
    const words = paragraph.split(" ");
    let line = "";
    for (const word of words) {
      if (line.length + word.length + 1 > width) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

// ── Sub-components ──

function NavBar({ state, agentName, phase }: { state: MatchState | null; agentName: string; phase: AgentPhase }) {
  return (
    <Box paddingX={1} height={1}>
      <Text bold color="white" backgroundColor="black"> DEAD</Text>
      <Text bold color="red" backgroundColor="black">NET </Text>
      <Text backgroundColor="black" color="gray"> {agentName} </Text>
      {state && (
        <>
          <Text backgroundColor="black" color="gray"> #{state.match_id.slice(-4)} </Text>
          <Text backgroundColor="black" color="green"> {state.status === "active" ? "● LIVE" : state.status} </Text>
          <Box flexGrow={1}><Text backgroundColor="black"> </Text></Box>
          <Text backgroundColor="black" color="gray"> {state.time_remaining_seconds}s </Text>
        </>
      )}
      {!state && <Box flexGrow={1}><Text backgroundColor="black"> </Text></Box>}
    </Box>
  );
}

function TopicBar({ state }: { state: MatchState }) {
  return (
    <Box paddingX={1} height={1}>
      <Text backgroundColor="yellow" color="black" bold> {state.match_type.toUpperCase()} </Text>
      <Text backgroundColor="yellow" color="black"> {state.topic.length > 70 ? state.topic.slice(0, 67) + "..." : state.topic} </Text>
      <Box flexGrow={1}><Text backgroundColor="yellow"> </Text></Box>
    </Box>
  );
}

function ScoreBar({ state, agentName }: { state: MatchState; agentName: string }) {
  const oppName = state.opponent.name;
  const myScore = state.score[state.your_side] || 0;
  const oppScore = state.score[state.your_side === "A" ? "B" : "A"] || 0;
  const total = myScore + oppScore || 1;
  const myPct = Math.round((myScore / total) * 100);
  const oppPct = 100 - myPct;
  const myColor = state.your_side === "A" ? "blue" : "red";
  const oppColor = state.your_side === "A" ? "red" : "blue";

  return (
    <Box paddingX={1} gap={1} height={1}>
      <Text bold color={myColor}>{agentName} {myPct}%</Text>
      <Text color="gray">({myScore})</Text>
      <Text bold color={myColor}>{"█".repeat(Math.round(myPct / 5))}</Text>
      <Text bold color={oppColor}>{"█".repeat(Math.round(oppPct / 5))}</Text>
      <Text color="gray">({oppScore})</Text>
      <Text bold color={oppColor}>{oppPct}% {oppName}</Text>
    </Box>
  );
}

function PhaseDivider({ label }: { label: string }) {
  return (
    <Box paddingX={1} height={1}>
      <Text backgroundColor="black" color="white" bold> {label.toUpperCase()} </Text>
      <Box flexGrow={1}><Text backgroundColor="black" color="gray">{"─".repeat(60)}</Text></Box>
    </Box>
  );
}

function TurnBubble({
  agent,
  agentName,
  content,
  side,
  matchType,
  turnIndex,
  termWidth,
}: {
  agent: string;
  agentName: string;
  content: string;
  side: "A" | "B";
  matchType: string;
  turnIndex: number;
  termWidth: number;
}) {
  const isMe = agent === side;
  const color = agent === "A" ? "blue" : "red";
  const maxW = Math.min(Math.floor(termWidth * 0.75), 80);

  if (agent === "SYSTEM") {
    return (
      <Box paddingX={2} justifyContent="center">
        <Text color="magenta" dimColor>↑ injection: "{content}"</Text>
      </Box>
    );
  }

  const phase = getPhase(turnIndex, matchType);
  const isStatement = matchType === "debate" && (phase === "opening" || phase === "closing");

  if (isStatement) {
    // Statement style — bordered block
    const lines = wrapText(content, maxW - 4);
    return (
      <Box flexDirection="column" paddingX={2} paddingY={0}>
        <Box gap={1}>
          <Text bold color={color}>┃ {agentName}</Text>
        </Box>
        {lines.map((line, i) => (
          <Box key={i}>
            <Text color={color}>┃</Text>
            <Text> {line}</Text>
          </Box>
        ))}
        <Text color={color}>┗{"━".repeat(maxW - 1)}</Text>
      </Box>
    );
  }

  // Bubble style — rebuttal / freeform / story
  const lines = wrapText(content, maxW - 6);
  const bubbleAlign = isMe ? "flex-end" : "flex-start";

  return (
    <Box flexDirection="column" paddingX={2} alignItems={bubbleAlign}>
      <Text color={color} dimColor bold> {agentName}</Text>
      <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} width={Math.min(maxW, Math.max(...lines.map(l => l.length)) + 4)}>
        {lines.map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
      </Box>
    </Box>
  );
}

function ThinkingIndicator({ agentName, color }: { agentName: string; color: string }) {
  return (
    <Box paddingX={2} gap={1}>
      <Text color={color}><Spinner type="dots" /></Text>
      <Text color={color} dimColor>{agentName} is thinking...</Text>
    </Box>
  );
}

// ── Main Pretty App ──

export function PrettyApp({ config, provider }: Props) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [phase, setPhase] = useState<AgentPhase>("init");
  const [agentName, setAgentName] = useState("?");
  const [matchState, setMatchState] = useState<MatchState | null>(null);
  const [statusMsg, setStatusMsg] = useState("initializing...");
  const [engine] = useState(() => new AgentEngine(config, provider));

  const termWidth = stdout?.columns || 80;

  useEffect(() => {
    const unsub = engine.on((newPhase, data) => {
      setPhase(newPhase);
      setAgentName(engine.agentName);
      setMatchState(engine.lastState ? { ...engine.lastState } : null);

      // Status message for non-match phases
      if (data && typeof data === "object" && "message" in data) {
        setStatusMsg(data.message);
      }
    });

    engine.run().then(() => {
      setTimeout(() => exit(), 500);
    }).catch(() => {
      setTimeout(() => exit(), 2000);
    });

    return unsub;
  }, []);

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      engine.stop();
      exit();
    }
  });

  // Pre-match states
  if (!matchState || matchState.status === "waiting") {
    return (
      <Box flexDirection="column" height="100%">
        <NavBar state={null} agentName={agentName} phase={phase} />
        <Box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column" gap={1}>
          <Box gap={1}>
            <Text bold>DEAD</Text><Text bold color="red">NET</Text>
          </Box>
          <Box gap={1}>
            <Text color="yellow"><Spinner type="dots" /></Text>
            <Text color="yellow">
              {phase === "connecting" && "connecting..."}
              {phase === "queuing" && `joining ${config.matchType} queue...`}
              {phase === "waiting" && "waiting for opponent..."}
              {phase === "init" && "initializing..."}
              {phase === "error" && "error — check config"}
              {phase === "exiting" && "done"}
              {!["connecting", "queuing", "waiting", "init", "error", "exiting"].includes(phase) && statusMsg}
            </Text>
          </Box>
          {agentName !== "?" && (
            <Text dimColor>playing as {agentName} • {config.provider}/{config.model}</Text>
          )}
        </Box>
        <Box paddingX={1}>
          <Text dimColor>q to quit</Text>
        </Box>
      </Box>
    );
  }

  // In-match view
  const s = matchState;
  const history = s.history || [];
  const oppName = s.opponent.name;
  const myName = agentName;

  // Group turns by phase for debate
  let lastPhase = "";

  return (
    <Box flexDirection="column" height="100%">
      <NavBar state={s} agentName={myName} phase={phase} />
      <TopicBar state={s} />
      {s.match_type !== "story" && <ScoreBar state={s} agentName={myName} />}

      {/* Transcript */}
      <Box flexDirection="column" flexGrow={1} overflowY="hidden" paddingY={1}>
        {history.map((turn, i) => {
          const elements: React.ReactNode[] = [];
          const currentPhase = getPhase(i, s.match_type);

          if (s.match_type === "debate" && currentPhase !== lastPhase) {
            lastPhase = currentPhase;
            elements.push(<PhaseDivider key={`phase-${i}`} label={currentPhase === "opening" ? "opening statements" : currentPhase === "rebuttal" ? "rebuttals" : "closing statements"} />);
          }

          const turnAgentName = turn.agent === s.your_side ? myName : (turn.agent === "SYSTEM" ? "SYSTEM" : oppName);

          elements.push(
            <TurnBubble
              key={`turn-${i}`}
              agent={turn.agent}
              agentName={turnAgentName}
              content={turn.content}
              side={s.your_side}
              matchType={s.match_type}
              turnIndex={i}
              termWidth={termWidth}
            />
          );

          return elements;
        })}

        {/* Thinking indicator */}
        {phase === "thinking" && (
          <ThinkingIndicator agentName={myName} color={s.your_side === "A" ? "blue" : "red"} />
        )}
        {phase === "opponent_turn" && (
          <ThinkingIndicator agentName={oppName} color={s.your_side === "A" ? "red" : "blue"} />
        )}
      </Box>

      {/* Bottom bar */}
      <Box paddingX={1} gap={2} height={1} borderStyle="single" borderColor="gray" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
        <Text dimColor>turn {s.turn_number}/{s.max_turns}</Text>
        {s.phase && <Text color="yellow">{s.phase.name}</Text>}
        {s.your_position && <Text color="cyan">{s.your_position}</Text>}
        <Box flexGrow={1} />
        <Text dimColor>q to quit</Text>
      </Box>
    </Box>
  );
}
