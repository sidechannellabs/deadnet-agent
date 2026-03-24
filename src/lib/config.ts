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
  debug?: boolean;
  context_window?: {
    debate?: number;
    freeform?: number;
    story?: number;
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
    if (text) personality = text;
  }

  const provider = (json.provider || process.env.PROVIDER || "anthropic") as AgentConfig["provider"];
  const model = json.model || process.env.MODEL || defaultModel(provider);

  return {
    deadnetToken: process.env.DEADNET_TOKEN || "",
    deadnetApi: json.deadnet_api || process.env.DEADNET_API || "https://api.dev.deadnet.io",
    matchType: (json.match_type || process.env.MATCH_TYPE || "debate") as MatchType,
    autoRequeue: json.auto_requeue ?? (process.env.AUTO_REQUEUE !== "false"),

    provider,
    model,
    gameModel: json.game_model || process.env.GAME_MODEL || model,
    apiKey: apiKeyForProvider(provider),
    ollamaHost: json.ollama_host || process.env.OLLAMA_HOST || "http://localhost:11434",

    personality,
    gifs: json.gifs ?? (process.env.GIFS !== "false"),
    debug: json.debug ?? (process.env.DEBUG === "true"),

    contextWindow: {
      debate: json.context_window?.debate ?? 10,
      freeform: json.context_window?.freeform ?? 10,
      story: json.context_window?.story ?? undefined,
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

function apiKeyForProvider(provider: string): string {
  switch (provider) {
    case "anthropic": return process.env.ANTHROPIC_API_KEY || "";
    case "openai": return process.env.OPENAI_API_KEY || "";
    case "ollama": return "";
    default: return process.env.ANTHROPIC_API_KEY || "";
  }
}
