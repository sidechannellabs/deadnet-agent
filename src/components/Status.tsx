import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { AgentPhase, MatchState } from "../lib/types.js";

type Props = {
  phase: AgentPhase;
  matchState: MatchState | null;
  tokens: { input: number; output: number; calls: number };
};

const PHASE_DISPLAY: Record<AgentPhase, { label: string; color: string; spin: boolean }> = {
  init:          { label: "initializing",     color: "gray",    spin: true },
  connecting:    { label: "connecting",        color: "yellow",  spin: true },
  queuing:       { label: "joining queue",     color: "yellow",  spin: true },
  waiting:       { label: "waiting for match", color: "magenta", spin: true },
  playing:       { label: "in match",          color: "green",   spin: false },
  thinking:      { label: "thinking",          color: "cyan",    spin: true },
  submitting:    { label: "submitting turn",   color: "blue",    spin: true },
  opponent_turn: { label: "opponent's turn",   color: "yellow",  spin: true },
  match_end:     { label: "match ended",       color: "white",   spin: false },
  error:         { label: "error",             color: "red",     spin: false },
  exiting:       { label: "done",              color: "gray",    spin: false },
};

export function Status({ phase, matchState, tokens }: Props) {
  const display = PHASE_DISPLAY[phase] || PHASE_DISPLAY.init;
  const s = matchState;

  return (
    <Box flexDirection="column" paddingX={1} marginY={0}>
      {/* Phase indicator */}
      <Box gap={1}>
        {display.spin ? (
          <Text color={display.color}><Spinner type="dots" /></Text>
        ) : (
          <Text color={display.color}>●</Text>
        )}
        <Text color={display.color} bold>{display.label}</Text>
      </Box>

      {/* Match info */}
      {s && (
        <Box flexDirection="column" marginTop={0} paddingLeft={2}>
          <Box gap={1}>
            <Text dimColor>topic:</Text>
            <Text>{s.topic.length > 60 ? s.topic.slice(0, 57) + "..." : s.topic}</Text>
          </Box>
          <Box gap={1}>
            <Text dimColor>vs</Text>
            <Text color="red">{s.opponent.name}</Text>
            <Text dimColor>•</Text>
            <Text dimColor>turn</Text>
            <Text bold>{s.turn_number}/{s.max_turns}</Text>
            {s.phase && (
              <>
                <Text dimColor>•</Text>
                <Text color="yellow">{s.phase.name}</Text>
              </>
            )}
            <Text dimColor>•</Text>
            <Text>{s.time_remaining_seconds}s</Text>
          </Box>
          <Box gap={1}>
            <Text dimColor>score:</Text>
            <Text color="blue">{s.score.A}</Text>
            <Text dimColor>-</Text>
            <Text color="red">{s.score.B}</Text>
            <Text dimColor>({s.your_side === "A" ? "you're blue" : "you're orange"})</Text>
            {s.your_position && (
              <>
                <Text dimColor>•</Text>
                <Text color="cyan">{s.your_position}</Text>
              </>
            )}
          </Box>
        </Box>
      )}

      {/* Token usage */}
      {tokens.calls > 0 && (
        <Box paddingLeft={2} gap={1}>
          <Text dimColor>tokens:</Text>
          <Text dimColor>{tokens.input}in/{tokens.output}out</Text>
          <Text dimColor>({tokens.calls} calls)</Text>
        </Box>
      )}
    </Box>
  );
}
