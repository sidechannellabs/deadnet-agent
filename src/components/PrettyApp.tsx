import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import { AgentEngine } from "../lib/engine.js";
import type { AgentConfig, AgentPhase, MatchState } from "../lib/types.js";
import type { LLMProvider } from "../providers/base.js";

type Props = {
  config: AgentConfig;
  provider: LLMProvider;
  gameProvider: LLMProvider;
};

// ── Helpers ──

function getPhase(turnIndex: number, matchType: string): string {
  if (matchType !== "debate") return "";
  if (turnIndex < 2) return "opening";
  if (turnIndex < 8) return "rebuttal";
  return "closing";
}

function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
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
        if (line) lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [""];
}

// ── Render a single turn into lines with color info ──

type RenderLine = { text: string; color?: string; dim?: boolean; bold?: boolean; align?: "left" | "right" | "center"; bg?: string };

function renderTurn(
  agent: string,
  agentName: string,
  content: string,
  side: "A" | "B",
  matchType: string,
  turnIndex: number,
  width: number,
): RenderLine[] {
  const color = agent === "A" ? "blue" : agent === "B" ? "red" : "magenta";
  const isMe = agent === side;
  const maxW = Math.min(Math.floor(width * 0.7), 76);

  if (agent === "SYSTEM") {
    return [{ text: `  ↑ injection: "${content}"`, color: "magenta", dim: true, align: "center" }];
  }

  const phase = getPhase(turnIndex, matchType);
  const isStatement = matchType === "debate" && (phase === "opening" || phase === "closing");
  const lines: RenderLine[] = [];

  if (isStatement) {
    lines.push({ text: `  ┃ ${agentName}`, color, bold: true });
    for (const l of wrapText(content, maxW - 4)) {
      lines.push({ text: `  ┃ ${l}`, color: undefined });
    }
    lines.push({ text: `  ┗${"━".repeat(Math.min(maxW, width - 4))}`, color });
    lines.push({ text: "", color: undefined });
  } else {
    // Chat bubble
    const innerW = maxW - 4; // space inside │ ... │
    const wrapped = wrapText(content, innerW);
    const longestLine = Math.max(...wrapped.map((l) => l.length));
    const contentW = Math.min(innerW, longestLine); // inner content width
    const align = isMe ? "right" : "left";

    lines.push({ text: ` ${agentName}`, color, dim: true, bold: true, align });
    lines.push({ text: `╭${"─".repeat(contentW + 2)}╮`, color, align });
    for (const l of wrapped) {
      lines.push({ text: `│ ${l}${" ".repeat(Math.max(0, contentW - l.length))} │`, color, align });
    }
    lines.push({ text: `╰${"─".repeat(contentW + 2)}╯`, color, align });
    lines.push({ text: "", color: undefined });
  }

  return lines;
}

// ── Sub-components ──

function FullWidthBar({ children, bg }: { children: React.ReactNode; bg?: string }) {
  return (
    <Box width="100%">
      <Text backgroundColor={bg || "black"} wrap="truncate-end">
        {children}
      </Text>
    </Box>
  );
}

// ── Main Pretty App ──

// ── Board rendering ──

type Seg = { text: string; color?: string; dim?: boolean; bold?: boolean };

function toBoardSegs(line: string, myColor: string, oppColor: string): Seg[] {
  const segs: Seg[] = [];
  for (const ch of line) {
    let color: string | undefined;
    let dim = false;
    let bold = false;
    if (ch === "X") { color = myColor; bold = true; }
    else if (ch === "O") { color = oppColor; bold = true; }
    else if (ch === "·" || ch === ".") { dim = true; }

    const last = segs[segs.length - 1];
    if (last && last.color === color && last.dim === dim && last.bold === bold) {
      last.text += ch;
    } else {
      segs.push({ text: ch, color, dim, bold });
    }
  }
  return segs;
}

function BoardLine({ line, myColor, oppColor }: { line: string; myColor: string; oppColor: string }) {
  const segs = toBoardSegs(line, myColor, oppColor);
  return (
    <Box>
      <Text>
        {segs.map((seg, i) => (
          <Text key={i} color={seg.color} dimColor={seg.dim} bold={seg.bold}>
            {seg.text}
          </Text>
        ))}
      </Text>
    </Box>
  );
}

function GameBoard({
  gameState, myColor, oppColor, maxLines,
}: {
  gameState: any; myColor: string; oppColor: string; maxLines: number;
}) {
  if (!gameState?.board_render) {
    return (
      <Box flexGrow={1} alignItems="center" justifyContent="center">
        <Text dimColor>waiting for board...</Text>
      </Box>
    );
  }

  const lines = (gameState.board_render as string).split("\n").slice(0, maxLines);

  return (
    <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
      {lines.map((line, i) => (
        <BoardLine key={i} line={line} myColor={myColor} oppColor={oppColor} />
      ))}
    </Box>
  );
}

// ── Main Pretty App ──

export function PrettyApp({ config, provider, gameProvider }: Props) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [phase, setPhase] = useState<AgentPhase>("init");
  const [agentName, setAgentName] = useState("?");
  const [matchState, setMatchState] = useState<MatchState | null>(null);
  const [lastGameState, setLastGameState] = useState<any>(null);
  const [lastError, setLastError] = useState<string>("");
  const [engine] = useState(() => new AgentEngine(config, provider, gameProvider));

  const cols = stdout?.columns || 80;
  const rows = stdout?.rows || 24;

  useEffect(() => {
    const unsub = engine.on((newPhase) => {
      setPhase(newPhase);
      setAgentName(engine.agentName);
      setMatchState(engine.lastState ? { ...engine.lastState } : null);
      setLastGameState(engine.lastGameState ? { ...engine.lastGameState } : null);
      if (newPhase === "error") {
        const errLog = [...engine.logs].reverse().find(l => l.level === "error");
        if (errLog) setLastError(errLog.message);
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
      process.stdout.write("\x1b[?25h"); // restore cursor
      exit();
    }
  });

  // Build transcript lines (must be before any early return — rules of hooks)
  const allLines = useMemo(() => {
    if (!matchState || matchState.status !== "active") return [];
    const history = matchState.history || [];
    const myName = agentName;
    const oppName = matchState.opponent.name;
    const result: RenderLine[] = [];
    let lastP = "";

    for (let i = 0; i < history.length; i++) {
      const turn = history[i];
      const p = getPhase(i, matchState.match_type);

      if (matchState.match_type === "debate" && p !== lastP) {
        lastP = p;
        const label = p === "opening" ? "OPENING STATEMENTS" : p === "rebuttal" ? "REBUTTALS" : "CLOSING STATEMENTS";
        result.push({ text: ` ${label} ${"─".repeat(Math.max(0, cols - label.length - 3))}`, bg: "black", color: "white", bold: true });
      }

      const turnName = turn.agent === matchState.your_side ? myName : turn.agent === "SYSTEM" ? "SYSTEM" : oppName;
      result.push(...renderTurn(turn.agent, turnName, turn.content, matchState.your_side, matchState.match_type, i, cols));
    }

    return result;
  }, [matchState, agentName, cols]);

  // Pre-match: centered splash
  if (!matchState || matchState.status !== "active") {
    const isWaiting = ["connecting", "queuing", "waiting", "init"].includes(phase);
    const statusText =
      phase === "connecting" ? "connecting..." :
      phase === "queuing" ? `joining ${config.matchType} queue...` :
      phase === "waiting" ? "waiting for opponent..." :
      phase === "init" ? "initializing..." :
      phase === "match_end" ? "match ended" :
      phase === "error" ? "error — check config" :
      phase === "exiting" ? "done" : "...";

    return (
      <Box flexDirection="column" width={cols} height={rows}>
        <Box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
          <Text>
            <Text bold color="white">DEAD</Text><Text bold color="red">NET</Text>
          </Text>
          <Text> </Text>
          <Text color={isWaiting ? "yellow" : "gray"}>{statusText}</Text>
          {isWaiting && <Text color="yellow"><Spinner type="line" /></Text>}
          {phase === "error" && lastError && (
            <>
              <Text> </Text>
              <Text color="red" dimColor>{lastError}</Text>
            </>
          )}
          {agentName !== "?" && (
            <>
              <Text> </Text>
              <Text dimColor>{agentName} • {config.provider}/{config.model}</Text>
            </>
          )}
        </Box>
        <Box paddingX={1} justifyContent="center">
          <Text dimColor>q to quit</Text>
        </Box>
      </Box>
    );
  }

  // ── In-match fullscreen ──
  const s = matchState!;
  const oppName = s.opponent.name;
  const myName = agentName;

  // Reserve lines: header(1) + topic(1) + score(1) + bottom(1) = 4, plus thinking(1)
  const headerLines = s.match_type === "story" ? 2 : 3;
  const footerLines = 2; // status + thinking/spacer
  const transcriptHeight = rows - headerLines - footerLines;

  // For game matches, calculate board vs taunt split
  const isGame = s.match_type === "game";
  const boardLineCount = lastGameState?.board_render
    ? (lastGameState.board_render as string).split("\n").length + 1 // +1 for top padding
    : 0;
  const tauntLines = isGame ? Math.max(0, transcriptHeight - boardLineCount) : 0;

  // Show last N lines of transcript (chat-style, grows from bottom)
  const visibleLines = allLines.slice(-Math.max(1, isGame ? tauntLines : transcriptHeight));
  // Pad with empty lines if transcript is shorter than available space
  const padCount = Math.max(0, (isGame ? tauntLines : transcriptHeight) - visibleLines.length);

  // Score bar
  const myScore = s.score[s.your_side] || 0;
  const oppScore = s.score[s.your_side === "A" ? "B" : "A"] || 0;
  const total = myScore + oppScore || 1;
  const myPct = Math.round((myScore / total) * 100);
  const oppPct = 100 - myPct;
  const barWidth = Math.max(0, cols - 30);
  const myBlocks = Math.round((myPct / 100) * barWidth);
  const oppBlocks = barWidth - myBlocks;
  const myColor = s.your_side === "A" ? "blue" : "red";
  const oppColor = s.your_side === "A" ? "red" : "blue";

  // Thinking
  const isThinking = phase === "thinking";
  const isOppTurn = phase === "opponent_turn";
  const thinkingName = isThinking ? myName : isOppTurn ? oppName : null;
  const thinkingColor = isThinking ? myColor : oppColor;

  // Timer
  const timeStr = `${Math.floor(s.time_remaining_seconds / 60)}:${String(Math.floor(s.time_remaining_seconds % 60)).padStart(2, "0")}`;

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      {/* Nav */}
      <Box>
        <Text backgroundColor="black"><Text bold color="white"> DEAD</Text><Text bold color="red">NET</Text></Text>
        <Text backgroundColor="black" color="gray"> {myName} </Text>
        <Text backgroundColor="black" color="gray">#{s.match_id.slice(-4)} </Text>
        <Text backgroundColor="black" color="green">● LIVE </Text>
        <Text backgroundColor="black">{" ".repeat(Math.max(0, cols - myName.length - s.match_id.slice(-4).length - 24))}</Text>
        <Text backgroundColor="black" color="white"> {timeStr} </Text>
      </Box>

      {/* Topic */}
      <Box>
        <Text backgroundColor="yellow" color="black" bold> {s.match_type.toUpperCase()} </Text>
        <Text backgroundColor="yellow" color="black"> {s.topic.slice(0, cols - s.match_type.length - 4)}</Text>
        <Text backgroundColor="yellow">{" ".repeat(Math.max(0, cols - s.topic.length - s.match_type.length - 4))}</Text>
      </Box>

      {/* Score (not for story) */}
      {s.match_type !== "story" && (
        <Box gap={0}>
          <Text bold color={myColor}> {myName} {myPct}% </Text>
          <Text bold color={myColor}>{"█".repeat(myBlocks)}</Text>
          <Text bold color={oppColor}>{"█".repeat(oppBlocks)}</Text>
          <Text bold color={oppColor}> {oppPct}% {oppName}</Text>
        </Box>
      )}

      {/* Game board — shown instead of chat transcript for game matches */}
      {isGame && (
        <GameBoard
          gameState={lastGameState}
          myColor={myColor}
          oppColor={oppColor}
          maxLines={boardLineCount}
        />
      )}

      {/* Transcript — chat bubbles (game: only taunts; others: full history) */}
      {padCount > 0 && (
        <Box flexDirection="column" height={padCount}>
          {Array.from({ length: padCount }, (_, i) => (
            <Text key={`pad-${i}`}> </Text>
          ))}
        </Box>
      )}
      <Box flexDirection="column">
        {visibleLines.map((line, i) => (
          <Box key={i} justifyContent={line.align === "right" ? "flex-end" : line.align === "center" ? "center" : "flex-start"} width={cols}>
            <Text
              color={line.color}
              dimColor={line.dim}
              bold={line.bold}
              backgroundColor={line.bg}
              wrap="truncate-end"
            >
              {line.text}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Thinking / spacer */}
      <Box height={1} paddingX={1}>
        {thinkingName ? (
          <Box gap={1}>
            <Text color={thinkingColor}><Spinner type="dots" /></Text>
            <Text color={thinkingColor} dimColor>{thinkingName} is thinking...</Text>
          </Box>
        ) : (
          <Text> </Text>
        )}
      </Box>

      {/* Bottom bar */}
      <Box>
        <Text backgroundColor="#222" color="gray"> turn {s.turn_number}/{s.max_turns} </Text>
        {s.phase && <Text backgroundColor="#222" color="yellow"> {s.phase.name} </Text>}
        {s.your_position && <Text backgroundColor="#222" color="cyan"> {s.your_position} </Text>}
        <Text backgroundColor="#222">{" ".repeat(Math.max(0, cols - 32 - (s.phase?.name.length || 0) - (s.your_position?.length || 0) - String(engine.sessionInputTokens).length - String(engine.sessionOutputTokens).length - engine.sessionCost.toFixed(4).length))}</Text>
        <Text backgroundColor="#222" color="gray"> {engine.sessionInputTokens}in/{engine.sessionOutputTokens}out </Text>
        <Text backgroundColor="#222" color="green"> ${engine.sessionCost.toFixed(4)} </Text>
        <Text backgroundColor="#222" dimColor> q quit </Text>
      </Box>
    </Box>
  );
}
