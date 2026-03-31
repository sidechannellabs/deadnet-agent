import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { config as loadDotenv } from "dotenv";
import type { AgentConfig, MatchType } from "./types.js";

type ConfigJson = {
  provider?: string;
  model?: string;
  game_model?: string;
  ollama_host?: string;
  match_type?: string;
  auto_requeue?: boolean;
  deadnet_api?: string;
  gifs?: boolean;
  context_window?: {
    debate?: number;
    freeform?: number;
    story?: number;
    game?: number;
  };
};

export function loadConfig(agentDir: string): AgentConfig {
  const dir = resolve(agentDir);

  // Load .env
  const envPath = resolve(dir, ".env");
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath });
  }

  // Load config.json (optional)
  let json: ConfigJson = {};
  const jsonPath = resolve(dir, "config.json");
  if (existsSync(jsonPath)) {
    json = JSON.parse(readFileSync(jsonPath, "utf-8"));
  }

  // Load PERSONALITY.md
  let personality =
    "You are a sharp, articulate competitor. You adapt your tone to the " +
    "format — incisive in debate, inventive in freeform, vivid in story. " +
    "You never hedge. You never waffle. Every sentence earns its place.";

  const personalityPath = resolve(dir, "PERSONALITY.md");
  if (existsSync(personalityPath)) {
    const text = readFileSync(personalityPath, "utf-8").trim();
    if (text.length > 2000) {
        console.warn("[config] PERSONALITY.md exceeds 500 tokens — truncating to 2000 chars");
        personality = text.slice(0, 2000);
      } else if (text) {
        personality = text;
      }
  }


  // Load STRATEGY.md (game matches only) — cap at 2000 chars (~500 tokens)
  let strategy = "";
  const strategyPath = resolve(dir, "STRATEGY.md");
  if (existsSync(strategyPath)) {
    const text = readFileSync(strategyPath, "utf-8").trim();
    if (text.length > 2000) {
      console.warn("[config] STRATEGY.md exceeds 500 tokens — truncating to 2000 chars");
      strategy = text.slice(0, 2000);
    } else {
      strategy = text;
    }
  }
  const provider = (json.provider || process.env.PROVIDER || "anthropic") as AgentConfig["provider"];
  const rawModel = json.model || process.env.MODEL || "auto";
  const model = rawModel === "auto" ? defaultModel(provider) : rawModel;
  // game_model defaults to Haiku for Anthropic (structured task, no quality loss)
  // falls back to the primary model for other providers
  const rawGameModel = json.game_model || process.env.GAME_MODEL || "auto";
  const gameModel = rawGameModel === "auto" ? defaultGameModel(provider, model) : rawGameModel;

  return {
    deadnetToken: process.env.DEADNET_TOKEN || "",
    deadnetApi: json.deadnet_api || process.env.DEADNET_API || "https://api.deadnet.io",
    matchType: (json.match_type || process.env.MATCH_TYPE || "debate") as MatchType,
    autoRequeue: json.auto_requeue ?? (process.env.AUTO_REQUEUE !== "false"),

    provider,
    model,
    gameModel,
    apiKey: apiKeyForProvider(provider),
    ollamaHost: json.ollama_host || process.env.OLLAMA_HOST || "http://localhost:11434",

    personality,
    strategy,
    gifs: json.gifs ?? (process.env.GIFS !== "false"),
    debug: process.env.DEBUG === "1",
    contextWindow: {
      debate: json.context_window?.debate ?? 4,
      freeform: json.context_window?.freeform ?? 6,
      story: json.context_window?.story ?? 12,
      game: json.context_window?.game,
    },
  };
}

function defaultModel(provider: string): string {
  switch (provider) {
    case "anthropic": return "claude-sonnet-4-20250514";
    case "openai": return "gpt-4o";
    case "ollama": return "llama3.1";
    default: return "claude-sonnet-4-20250514";
  }
}

function defaultGameModel(provider: string, primaryModel: string): string {
  // For Anthropic, default game moves to Haiku — same strategic quality, ~4x cheaper.
  // For other providers, use the primary model (no known cheaper equivalent).
  if (provider === "anthropic") return "claude-haiku-4-5-20251001";
  return primaryModel;
}

function apiKeyForProvider(provider: string): string {
  switch (provider) {
    case "anthropic": return process.env.ANTHROPIC_API_KEY || "";
    case "openai": return process.env.OPENAI_API_KEY || "";
    case "ollama": return "";
    default: return process.env.ANTHROPIC_API_KEY || "";
  }
}
