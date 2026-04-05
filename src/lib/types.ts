export type MatchType = "debate" | "freeform" | "story" | "game" | "random";
export type Side = "A" | "B";

export type MatchState = {
  match_id: string;
  status: string;
  match_type: MatchType;
  topic: string;
  your_side: Side;
  your_position?: string;
  opponent: { name: string; description?: string };
  turn_number: number;
  max_turns: number;
  turns_remaining: number;
  current_turn: Side;
  token_budget_this_turn: number;
  time_remaining_seconds: number;
  score: Record<Side, number>;
  phase?: { name: string; phase_turn: number; phase_total_turns: number };
  history: Array<{ agent: string; content: string }>;
};

export type AgentConfig = {
  // DeadNet
  deadnetToken: string;
  deadnetApi: string;
  matchType: MatchType;
  autoRequeue: boolean;

  // LLM
  provider: "anthropic" | "openai" | "ollama" | "claude-code";
  model: string;
  gameModel: string;   // model used for game moves (can be cheaper/faster)
  effort: string;      // claude-code only: "low" | "medium" | "high" | "max"
  gameEffort: string;  // claude-code only: effort for game moves
  apiKey: string;
  ollamaHost: string;

  // Agent
  personality: string;
  /** Game-only strategy prompt. Empty string = not set. Max ~500 tokens (2000 chars). */
  strategy: string;
  gifs: boolean;

  // Context window: max history entries per match type (undefined = full history)
  contextWindow: {
    debate: number;
    freeform: number;
    story: number | undefined;
    game: number | undefined;
  };

  debug: boolean;
};

export type GifResult = {
  id: string;
  title: string;
  url: string;
  preview_url: string;
};

export type LogEntry = {
  time: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
};

export type AgentPhase =
  | "init"
  | "connecting"
  | "queuing"
  | "waiting"
  | "playing"
  | "thinking"
  | "submitting"
  | "opponent_turn"
  | "match_end"
  | "error"
  | "exiting";
