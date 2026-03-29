import { appendFileSync, writeFileSync } from "fs";
import { DeadNetClient, APIError } from "./api.js";
import { buildSystemPrompt, buildMessages, buildGamePrompt } from "./prompts.js";
import type { LLMProvider } from "../providers/base.js";
import type { AgentConfig, AgentPhase, LogEntry, MatchState } from "./types.js";

type Listener = (phase: AgentPhase, data?: any) => void;

export class AgentEngine {
  config: AgentConfig;
  client: DeadNetClient;
  provider: LLMProvider;
  gameProvider: LLMProvider;

  agentName = "?";
  matchId: string | null = null;
  lastState: MatchState | null = null;
  phase: AgentPhase = "init";
  logs: LogEntry[] = [];
  totalInputTokens = 0;
  totalOutputTokens = 0;
  totalCacheReadTokens = 0;
  totalCacheWriteTokens = 0;
  apiCalls = 0;

  // Session-level totals (never reset, accumulate across all matches)
  sessionInputTokens = 0;
  sessionOutputTokens = 0;
  sessionCacheReadTokens = 0;
  sessionCacheWriteTokens = 0;
  sessionApiCalls = 0;
  // Game-move tokens tracked separately so they're priced at gameModel rates
  sessionGameInputTokens = 0;
  sessionGameOutputTokens = 0;
  sessionGameCacheReadTokens = 0;
  sessionGameCacheWriteTokens = 0;

  get sessionCost(): number {
    return this._modelCost(this.config.model,
      this.sessionInputTokens - this.sessionGameInputTokens,
      this.sessionOutputTokens - this.sessionGameOutputTokens,
      this.sessionCacheReadTokens - this.sessionGameCacheReadTokens,
      this.sessionCacheWriteTokens - this.sessionGameCacheWriteTokens,
    ) + this._modelCost(this.config.gameModel,
      this.sessionGameInputTokens,
      this.sessionGameOutputTokens,
      this.sessionGameCacheReadTokens,
      this.sessionGameCacheWriteTokens,
    );
  }

  private _modelCost(model: string, input: number, output: number, cacheRead: number, cacheWrite: number): number {
    let inputPrice: number, outputPrice: number, cacheWritePrice: number, cacheReadPrice: number;
    if (model.startsWith("claude-haiku-4")) {
      inputPrice = 0.80; outputPrice = 4.00; cacheWritePrice = 1.00; cacheReadPrice = 0.08;
    } else if (model.startsWith("claude-sonnet-4")) {
      inputPrice = 3.00; outputPrice = 15.00; cacheWritePrice = 3.75; cacheReadPrice = 0.30;
    } else {
      return 0;
    }
    const uncached = input - cacheRead - cacheWrite;
    return (uncached * inputPrice + output * outputPrice + cacheWrite * cacheWritePrice + cacheRead * cacheReadPrice) / 1_000_000;
  }

  private listeners: Listener[] = [];
  private running = false;

  constructor(config: AgentConfig, provider: LLMProvider, gameProvider?: LLMProvider) {
    this.config = config;
    this.client = new DeadNetClient(config.deadnetApi, config.deadnetToken);
    this.provider = provider;
    this.gameProvider = gameProvider ?? provider;
    if (config.debug) writeFileSync("debug.log", `=== debug session ${new Date().toISOString()} ===\n`);
    writeFileSync("error.log", `=== session ${new Date().toISOString()} ===\n`);
  }

  on(listener: Listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(phase: AgentPhase, data?: any) {
    this.phase = phase;
    this.listeners.forEach((l) => l(phase, data));
  }

  private log(level: LogEntry["level"], message: string) {
    const entry: LogEntry = {
      time: new Date().toLocaleTimeString("en-US", { hour12: false }),
      level,
      message,
    };
    this.logs.push(entry);
    if (this.logs.length > 200) this.logs.shift();
    this.emit(this.phase, entry);
    if (level === "error" || level === "warn") {
      const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}\n`;
      appendFileSync("error.log", line);
    }
  }

  private debug(label: string, data: unknown) {
    if (!this.config.debug) return;
    // Write full formatted block to debug.log (tail -f debug.log to follow)
    appendFileSync("debug.log", formatDebugBlock(label, data) + "\n");
    // Short summary in the TUI log
    const preview = typeof data === "string"
      ? data.slice(0, 100).replace(/\n/g, "↵")
      : JSON.stringify(data).slice(0, 100);
    this.log("debug", `[${label}] ${preview}`);
  }

  async run() {
    this.running = true;
    try {
      await this.connect();
      while (this.running) {
        if (this.matchId) {
          await this.play();
        } else {
          await this.queue();
        }
        if (!this.matchId && !this.config.autoRequeue) {
          this.log("info", "exiting (auto-requeue disabled)");
          this.emit("exiting");
          return;
        }
      }
    } catch (e: any) {
      this.log("error", `fatal: ${e.message}`);
      this.emit("error", e);
    }
  }

  stop() {
    this.running = false;
  }

  // ── CONNECT ──

  private async connect() {
    this.emit("connecting");
    this.log("info", "connecting...");

    try {
      const resp = await this.client.connect();
      this.agentName = resp.name || "?";
      this.matchId = resp.current_match_id || null;
      const stats = resp.stats || {};
      this.log("info", `connected as "${this.agentName}" — ${stats.matches_played || 0} matches, ${stats.debate_wins || 0} wins`);
      if (this.matchId) {
        this.log("info", `resuming match ${this.matchId}`);
      }
    } catch (e: any) {
      if (e instanceof APIError && e.status === 401) {
        this.log("error", "authentication failed — check DEADNET_TOKEN");
        this.emit("error");
        throw e;
      }
      throw e;
    }
  }

  // ── QUEUE ──

  private pickMatchType(): string {
    if (this.config.matchType === "random") {
      const types = ["debate", "freeform", "story"];
      return types[Math.floor(Math.random() * types.length)];
    }
    return this.config.matchType;
  }

  private async queue() {
    const matchType = this.pickMatchType();
    this.emit("queuing");
    this.log("info", `joining ${matchType} queue...`);

    try {
      const resp = await this.client.joinQueue(matchType);
      if (resp.matched) {
        this.matchId = resp.match_id;
        this.log("info", `instantly matched! match_id=${this.matchId}`);
        return;
      }
      this.log("info", `queued at position ${resp.position || "?"} — waiting...`);
    } catch (e: any) {
      if (e instanceof APIError) {
        if (e.error === "already_in_match") {
          const cr = await this.client.connect();
          this.matchId = cr.current_match_id || null;
          if (this.matchId) this.log("info", `already in match ${this.matchId}`);
          return;
        }
        if (e.error === "already_in_queue") {
          this.log("info", "already in queue — waiting...");
        } else if (e.error === "queue_cooldown") {
          const wait = (e.data?.retry_after ?? 30) as number;
          this.log("info", `queue cooldown — retrying in ${wait}s...`);
          await this.sleep(wait * 1000);
          return; // re-enter run() loop → calls queue() again → retries joinQueue()
        } else {
          throw e;
        }
      } else {
        throw e;
      }
    }

    this.emit("waiting");
    while (!this.matchId && this.running) {
      await this.sleep(7000);
      try {
        const resp = await this.client.connect();
        this.matchId = resp.current_match_id || null;
        if (this.matchId) this.log("info", `matched! match_id=${this.matchId}`);
      } catch {
        /* retry */
      }
    }
  }

  // ── PLAY ──

  private async play() {
    this.emit("playing");
    this.resetUsage();

    while (this.running) {
      let state: MatchState;
      try {
        state = await this.client.getMatchState(this.matchId!);
      } catch (e: any) {
        if (e instanceof APIError && ["match_not_found", "not_in_match"].includes(e.error)) {
          this.log("warn", `match gone (${e.error})`);
          break;
        }
        throw e;
      }

      this.lastState = state;

      if (state.status === "waiting") {
        this.log("info", "match waiting for activation...");
        await this.sleep(5000);
        continue;
      }

      if (state.status !== "active") {
        this.log("info", `match ended (status=${state.status})`);
        break;
      }

      if (state.current_turn === state.your_side) {
        if (state.match_type === "game") {
          this.log("info", `move ${state.turn_number} vs ${state.opponent.name} — ${state.time_remaining_seconds}s left`);
          await this.takeGameMove(state);
        } else {
          const phase = state.phase;
          const phaseStr = phase ? ` [${phase.name.toUpperCase()}]` : "";
          const posStr = state.your_position ? ` (${state.your_position})` : "";
          this.log(
            "info",
            `turn ${state.turn_number}/${state.max_turns}${phaseStr}${posStr} vs ${state.opponent.name} — budget=${state.token_budget_this_turn}t, ${state.time_remaining_seconds}s left`,
          );
          await this.takeTurn(state);
        }
      } else {
        this.emit("opponent_turn");
        await this.sleep(7000);
      }
    }

    await this.onMatchEnd();
  }

  private async takeTurn(state: MatchState) {
    this.emit("thinking");
    this.log("info", "thinking...");

    const gifsEnabled = this.config.gifs;
    const system = buildSystemPrompt(state, this.config.personality, gifsEnabled);
    const cw = this.config.contextWindow;
    const contextWindow = cw[state.match_type as keyof typeof cw] as number | undefined;
    let messages: Array<{ role: "user" | "assistant"; content: any }> = buildMessages(state, { contextWindow });
    const budget = state.token_budget_this_turn || 100;
    const maxTokens = budget;

    this.debug("llm-request", { system, messages });

    let content = "";

    try {
      const result = await this.provider.generate(system, messages, maxTokens);
      this.totalInputTokens += result.inputTokens;
      this.totalOutputTokens += result.outputTokens;
      this.totalCacheReadTokens += result.cacheReadTokens;
      this.totalCacheWriteTokens += result.cacheWriteTokens;
      this.apiCalls++;
      this.sessionInputTokens += result.inputTokens;
      this.sessionOutputTokens += result.outputTokens;
      this.sessionCacheReadTokens += result.cacheReadTokens;
      this.sessionCacheWriteTokens += result.cacheWriteTokens;
      this.sessionApiCalls++;

      this.debug("llm-response", { content: result.content, stopReason: result.stopReason, inputTokens: result.inputTokens, outputTokens: result.outputTokens, cacheRead: result.cacheReadTokens, cacheWrite: result.cacheWriteTokens });

      if (result.stopReason === "truncated") {
        const truncated = truncateToLastSentence(result.content);
        this.log("warn", `response truncated at max_tokens — trimmed to last sentence (${result.content.length} → ${truncated.length} chars)`);
        content = truncated;
      } else {
        content = result.content;
      }
    } catch (e: any) {
      this.log("error", `LLM error: ${e.message}`);
      return;
    }

    // Strip GIF tags if gifs are disabled (safety net)
    if (!gifsEnabled) {
      content = content.replace(/\[gif:[^\]]+\]/g, "").trim();
    }

    if (!content || content.length < 5) {
      this.log("warn", "generated response too short — skipping");
      return;
    }

    this.emit("submitting");
    this.log("info", `submitting (${content.split(/\s+/).length} words)...`);

    try {
      let resp = await this.client.submitTurn(this.matchId!, content);

      if (!resp.accepted && resp.error === "over_token_limit") {
        const truncated = truncateToLastSentence(content);
        this.log("warn", `over_token_limit — truncating to last sentence and retrying`);
        resp = await this.client.submitTurn(this.matchId!, truncated);
      }

      if (resp.accepted) {
        this.log("info", `turn ${resp.turn_number || "?"} accepted`);
        if (resp.match_ended) this.log("info", "match ended after this turn");
      } else {
        this.log("warn", `submit rejected: ${resp.error}`);
      }
    } catch (e: any) {
      this.log("error", `submit error: ${e.message}`);
    }
  }

  private async takeGameMove(state: MatchState) {
    this.emit("thinking");
    this.log("info", "analyzing board...");

    let gameState: any;
    try {
      gameState = await this.client.getGameState(this.matchId!);
    } catch (e: any) {
      this.log("error", `failed to get game state: ${e.message}`);
      return;
    }

    this.debug("game-state", {
      your_turn: gameState.your_turn,
      valid_moves: gameState.valid_moves,
      board_render: gameState.board_render,
    });

    const rawValidMoves = gameState.valid_moves;
    const isCTF = rawValidMoves && !Array.isArray(rawValidMoves) && typeof rawValidMoves === "object";
    const validMoves: any[] = Array.isArray(rawValidMoves) ? rawValidMoves : [];
    const hasMoves = isCTF
      ? Object.keys(rawValidMoves).length > 0
      : validMoves.length > 0;

    if (!gameState.your_turn || !hasMoves) {
      this.log("info", `waiting — your_turn=${gameState.your_turn}, valid_moves=${isCTF ? JSON.stringify(Object.keys(rawValidMoves)) : validMoves.length}`);
      await this.sleep(3000);
      return;
    }

    // CTF: if all alive units are snared, submit a pass turn without calling the LLM
    if (isCTF) {
      const allSnared = Object.values(rawValidMoves as Record<string, any>).every(
        (v) => v && typeof v === "object" && !Array.isArray(v) && v.snared === true
      );
      if (allSnared) {
        this.log("info", "CTF: all units snared — submitting pass turn");
        await this.client.submitMove(this.matchId!, { commands: "" }, "All units snared — passing.");
        return;
      }
    }

    // Find the last message the opponent submitted (for tactical context)
    const oppSide = state.your_side === "A" ? "B" : "A";
    const opponentLastMessage = state.history
      ?.filter(t => t.agent === oppSide && t.content)
      .slice(-1)[0]?.content;

    const system = buildGamePrompt(gameState, this.config.personality, this.config.strategy, state.your_side, state.opponent.name, opponentLastMessage);
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [
      { role: "user", content: "Make your move." },
    ];

    this.debug("llm-request", { system, messages });

    let rawResponse = "";
    try {
      const result = await this.gameProvider.generate(system, messages, 100);
      this.totalInputTokens += result.inputTokens;
      this.totalOutputTokens += result.outputTokens;
      this.totalCacheReadTokens += result.cacheReadTokens;
      this.totalCacheWriteTokens += result.cacheWriteTokens;
      this.apiCalls++;
      this.sessionInputTokens += result.inputTokens;
      this.sessionOutputTokens += result.outputTokens;
      this.sessionCacheReadTokens += result.cacheReadTokens;
      this.sessionCacheWriteTokens += result.cacheWriteTokens;
      this.sessionGameInputTokens += result.inputTokens;
      this.sessionGameOutputTokens += result.outputTokens;
      this.sessionGameCacheReadTokens += result.cacheReadTokens;
      this.sessionGameCacheWriteTokens += result.cacheWriteTokens;
      this.sessionApiCalls++;
      rawResponse = result.content.trim();
    } catch (e: any) {
      this.log("error", `LLM error: ${e.message}`);
      return;
    }

    this.debug("llm-response", rawResponse);

    let move: any;
    let message: string | undefined;
    if (isCTF) {
      try {
        // Direct field extraction — more robust than full JSON parse
        const cmdMatch = rawResponse.match(/"commands"\s*:\s*"([^"]+)"/);
        if (!cmdMatch) throw new Error("missing commands field");
        move = { commands: cmdMatch[1] };
        const msgMatch = rawResponse.match(/"message"\s*:\s*"([^"]+)"/);
        if (msgMatch) message = msgMatch[1].slice(0, 280);
      } catch (e: any) {
        // Fallback: pick a random command per unit
        const unitMoves = rawValidMoves as Record<string, any>;
        let cmds = "";
        for (const [label, opts] of Object.entries(unitMoves)) {
          if (Array.isArray(opts) && opts.length > 0) {
            cmds += label + (opts as string[])[Math.floor(Math.random() * opts.length)];
          }
        }
        if (!cmds) {
          // All alive units are snared — submit a dummy command for any snared unit.
          // The engine clears the snare and skips the action, advancing the turn.
          const snaredLabel = Object.keys(unitMoves).find(k => unitMoves[k]?.snared);
          if (snaredLabel) {
            move = { commands: `${snaredLabel}A1M` };
            this.log("warn", `CTF: all units snared — passing turn via ${snaredLabel}`);
          } else {
            this.log("warn", `CTF: no valid moves and no snared units — skipping submit`);
            return;
          }
        } else {
          move = { commands: cmds };
          this.log("warn", `failed to parse CTF move (${e.message}) — random fallback: ${cmds}`);
        }
      }
    } else {
      try {
        // Direct field extraction — more robust than JSON.parse against malformed LLM output
        const moveMatch = rawResponse.match(/"move"\s*:\s*(\d+)/);
        if (!moveMatch) throw new Error("no move field found");
        const idx = parseInt(moveMatch[1], 10) - 1;
        if (isNaN(idx) || idx < 0 || idx >= validMoves.length) throw new Error(`invalid move index: ${moveMatch[1]}`);
        move = validMoves[idx];
        const msgMatch = rawResponse.match(/"message"\s*:\s*"([^"]*)"/);
        if (msgMatch) message = msgMatch[1].slice(0, 280);
      } catch (e: any) {
        move = validMoves[Math.floor(Math.random() * validMoves.length)];
        this.log("warn", `failed to parse move (${e.message}) — picking random: ${JSON.stringify(move)}`);
      }
    }

    // Coerce amount to integer — backend uses json.dumps(default=str) so Decimal arrives as "100" (string)
    if (move && move.amount !== undefined) {
      move = { ...move, amount: Math.round(Number(move.amount)) };
    }

    this.emit("submitting");
    this.log("info", `submitting move: ${JSON.stringify(move)}${message ? ` — "${message}"` : ""}`);

    try {
      const resp = await this.client.submitMove(this.matchId!, move, message);
      if (resp.accepted !== false) {
        this.log("info", `move accepted: ${JSON.stringify(move)}`);
        if (resp.winner) this.log("info", `game over — winner: ${resp.winner}`);
      } else {
        const err = resp.error || "unknown";
        if (err === "duplicate_move") {
          this.log("info", "move already submitted — polling until turn advances...");
          while (this.running) {
            await this.sleep(3000);
            try {
              const gs = await this.client.getGameState(this.matchId!);
              this.debug("duplicate-poll", { your_turn: gs.your_turn });
              if (!gs.your_turn) break;
            } catch {
              break;
            }
          }
        } else {
          this.log("warn", `move rejected: ${err} — retrying with safe fallback`);
          let fallbackMove: any = undefined;
          if (isCTF) {
            let fbCmds = "";
            for (const [label, opts] of Object.entries(rawValidMoves as Record<string, any>)) {
              if (Array.isArray(opts) && opts.length > 0) {
                fbCmds += label + (opts as string[])[Math.floor(Math.random() * opts.length)];
              }
            }
            if (fbCmds) fallbackMove = { commands: fbCmds };
          } else {
            fallbackMove = validMoves.find((m: any) => m.action === "call" || m.action === "check")
              ?? validMoves.find((m: any) => m.action === "fold")
              ?? validMoves[0];
          }
          if (fallbackMove) {
            try {
              const fb = await this.client.submitMove(this.matchId!, fallbackMove);
              if (fb.accepted !== false) {
                this.log("info", `fallback move accepted: ${JSON.stringify(fallbackMove)}`);
                if (fb.winner) this.log("info", `game over — winner: ${fb.winner}`);
              } else {
                this.log("warn", `fallback also rejected: ${fb.error}`);
              }
            } catch (fe: any) {
              this.log("error", `fallback submit error: ${fe.message}`);
            }
          }
        }
      }
    } catch (e: any) {
      this.log("error", `move submit error: ${e.message}`);
    }
  }

  private async onMatchEnd() {
    this.emit("match_end");

    if (this.matchId && this.lastState) {
      const s = this.lastState;
      const myScore = s.score[s.your_side] || 0;
      const oppScore = s.score[s.your_side === "A" ? "B" : "A"] || 0;
      const result = myScore > oppScore ? "won" : myScore < oppScore ? "lost" : "tied";
      this.log("info", `match ${this.matchId} — ${result} vs ${s.opponent.name} (${myScore}-${oppScore})`);
    }

    const cacheInfo = this.totalCacheReadTokens > 0
      ? `, ${this.totalCacheReadTokens} cache_read / ${this.totalCacheWriteTokens} cache_write`
      : "";
    this.log("info", `match usage: ${this.apiCalls} calls, ${this.totalInputTokens}in / ${this.totalOutputTokens}out${cacheInfo}`);
    this.log("info", `session total: ${this.sessionApiCalls} calls, ${this.sessionInputTokens}in / ${this.sessionOutputTokens}out — $${this.sessionCost.toFixed(4)}`);

    this.matchId = null;
    this.lastState = null;

    if (this.config.autoRequeue && this.running) {
      this.log("info", "re-queuing in 5s...");
      await this.sleep(5000);
    }
  }

  private resetUsage() {
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.totalCacheReadTokens = 0;
    this.totalCacheWriteTokens = 0;
    this.apiCalls = 0;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

/** Truncate text to the last complete sentence ending in . ! or ? */
function truncateToLastSentence(text: string): string {
  const match = text.match(/^([\s\S]*[.!?])\s*[^.!?]*$/);
  return match ? match[1].trim() : text.trim();
}

/** Format a labelled debug block for stderr output. */
function formatDebugBlock(label: string, data: unknown): string {
  const bar = "─".repeat(60);
  const header = `\n┌ ${label} ${"─".repeat(Math.max(0, 58 - label.length))}┐`;
  const footer = `└${bar}┘`;
  let body: string;
  if (typeof data === "string") {
    body = data;
  } else {
    body = JSON.stringify(data, null, 2);
  }
  const lines = body.split("\n").map((l) => `│ ${l}`).join("\n");
  return `${header}\n${lines}\n${footer}`;
}
