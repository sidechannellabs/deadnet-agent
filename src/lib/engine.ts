import { DeadNetClient, APIError } from "./api.js";
import { buildSystemPrompt, buildMessages, buildGamePrompt } from "./prompts.js";
import type { LLMProvider } from "../providers/base.js";
import type { AgentConfig, AgentPhase, LogEntry, MatchState } from "./types.js";

type Listener = (phase: AgentPhase, data?: any) => void;

export class AgentEngine {
  config: AgentConfig;
  client: DeadNetClient;
  provider: LLMProvider;

  agentName = "?";
  matchId: string | null = null;
  lastState: MatchState | null = null;
  phase: AgentPhase = "init";
  logs: LogEntry[] = [];
  totalInputTokens = 0;
  totalOutputTokens = 0;
  apiCalls = 0;

  // Session-level totals (never reset, accumulate across all matches)
  sessionInputTokens = 0;
  sessionOutputTokens = 0;
  sessionApiCalls = 0;

  get sessionCost(): number {
    const model = this.config.model;
    let inputPrice: number;
    let outputPrice: number;
    if (model.startsWith("claude-haiku-4")) {
      inputPrice = 0.80;
      outputPrice = 4.00;
    } else if (model.startsWith("claude-sonnet-4")) {
      inputPrice = 3.00;
      outputPrice = 15.00;
    } else {
      return 0;
    }
    return (this.sessionInputTokens * inputPrice + this.sessionOutputTokens * outputPrice) / 1_000_000;
  }

  private listeners: Listener[] = [];
  private running = false;

  constructor(config: AgentConfig, provider: LLMProvider) {
    this.config = config;
    this.client = new DeadNetClient(config.deadnetApi, config.deadnetToken);
    this.provider = provider;
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

    let content = "";

    try {
      const result = await this.provider.generate(system, messages, maxTokens);
      this.totalInputTokens += result.inputTokens;
      this.totalOutputTokens += result.outputTokens;
      this.apiCalls++;
      this.sessionInputTokens += result.inputTokens;
      this.sessionOutputTokens += result.outputTokens;
      this.sessionApiCalls++;

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

    const system = buildGamePrompt(gameState, this.config.personality, state.your_side, state.opponent.name);
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [
      { role: "user", content: "Make your move." },
    ];

    let rawResponse = "";
    try {
      const result = await this.provider.generate(system, messages, 100);
      this.totalInputTokens += result.inputTokens;
      this.totalOutputTokens += result.outputTokens;
      this.apiCalls++;
      this.sessionInputTokens += result.inputTokens;
      this.sessionOutputTokens += result.outputTokens;
      this.sessionApiCalls++;
      rawResponse = result.content.trim();
    } catch (e: any) {
      this.log("error", `LLM error: ${e.message}`);
      return;
    }

    let column: number;
    let message: string | undefined;
    try {
      const jsonMatch = rawResponse.match(/\{[^}]+\}/);
      if (!jsonMatch) throw new Error("no JSON found");
      const parsed = JSON.parse(jsonMatch[0]);
      column = parseInt(parsed.column, 10);
      if (isNaN(column) || column < 0 || column > 6) throw new Error(`invalid column: ${parsed.column}`);
      if (parsed.message && typeof parsed.message === "string") {
        message = parsed.message.slice(0, 280);
      }
    } catch (e: any) {
      const validMoves: number[] = gameState.valid_moves?.length ? gameState.valid_moves : [0, 1, 2, 3, 4, 5, 6];
      column = validMoves[Math.floor(Math.random() * validMoves.length)];
      this.log("warn", `failed to parse move (${e.message}) — picking random column ${column}`);
    }

    this.emit("submitting");
    this.log("info", `submitting move: column ${column!}${message ? ` — "${message}"` : ""}`);

    try {
      const resp = await this.client.submitMove(this.matchId!, { column: column! }, message);
      if (resp.accepted !== false) {
        this.log("info", `move accepted: column ${column!}`);
        if (resp.winner) this.log("info", `game over — winner: ${resp.winner}`);
      } else {
        this.log("warn", `move rejected: ${resp.error || "unknown"}`);
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

    this.log("info", `match usage: ${this.apiCalls} calls, ${this.totalInputTokens}in / ${this.totalOutputTokens}out`);
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
