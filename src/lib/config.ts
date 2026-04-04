import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, join } from "path";
import { homedir } from "os";
import { config as loadDotenv } from "dotenv";
import type { AgentConfig, MatchType } from "./types.js";

export function getConfigDir(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(appData, "deadnet-agent");
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgConfig, "deadnet-agent");
}

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

const DEFAULT_ENV = `\
# Your DeadNet agent token — get one at https://deadnet.io/dashboard
DEADNET_TOKEN=

# LLM provider API key — only the one matching "provider" in config.json is needed
ANTHROPIC_API_KEY=
# OPENAI_API_KEY=
`;

const DEFAULT_CONFIG = `\
{
  "provider": "anthropic",
  "model": "auto",
  "game_model": "auto",
  "match_type": "debate",
  "auto_requeue": true,
  "gifs": true
}
`;

const DEFAULT_PERSONALITY = `\
# My DeadNet Agent

You are a sharp, articulate competitor. You adapt your tone to the format —
incisive in debate, inventive in freeform, vivid in story.

## Debate Style
- Lead with your strongest argument, not a preamble.
- When countering, name exactly what your opponent got wrong before pivoting.
- Use concrete examples — real events, real numbers, real consequences.
- End turns with something memorable: a sharp question, a vivid image, a damning comparison.
- **Opening:** Plant your flag hard. Make your thesis impossible to ignore.
- **Rebuttal:** Go surgical. Dismantle their weakest point, then hit them with something new.
- **Closing:** Hammer home your two strongest points. End with the line the audience remembers.

## Freeform Style
- Genuinely curious. Ask questions that make the other agent think harder.
- Make unexpected connections between ideas.
- Comfortable with disagreement — don't smooth things over.

## Story Style
- Favor tension and subtext over exposition.
- Write characters who want something and are willing to act.
- Descriptions are sensory and specific, never generic.
`;

const DEFAULT_STRATEGY = `\
# Game Strategy

## General Principles
- Prioritize board control over piece preservation.
- Look two moves ahead: what does my move enable next turn?
- If ahead, simplify. If behind, complicate.
- Never let the opponent settle — keep them reacting to you.

## Drop4
- Stack the center columns first — they give the most winning lines.
- Block your opponent's three-in-a-row before extending your own two-in-a-row.
- When you have a forced win, take it immediately.

## Reversi
- Control the corners and edges — they can never be flipped.
- In the early game, fewer pieces is often better (more mobility).
- Force your opponent into moves that give you corners.

## CTF
- Rush the opponent's flag while keeping one unit back to defend yours.
- Snare their fastest unit first to disrupt their attack timing.

## Dots & Boxes
- Avoid completing the third side of any box early — it hands your opponent a chain.
- Sacrifice short chains to force your opponent to open the long ones.
`;

function setupConfigDir(dir: string): void {
  const isNew = !existsSync(dir);
  if (isNew) mkdirSync(dir, { recursive: true });

  const files: Array<{ name: string; content: string }> = [
    { name: ".env",           content: DEFAULT_ENV },
    { name: "config.json",    content: DEFAULT_CONFIG },
    { name: "PERSONALITY.md", content: DEFAULT_PERSONALITY },
    { name: "STRATEGY.md",    content: DEFAULT_STRATEGY },
  ];

  const written: string[] = [];
  for (const { name, content } of files) {
    const filePath = join(dir, name);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, content, "utf-8");
      written.push(name);
    }
  }

  if (written.length > 0) {
    console.log(`\nDeadNet agent config ${isNew ? "created" : "updated"} at: ${dir}`);
    console.log(`  Created: ${written.join(", ")}`);
    console.log(`\nNext step: add your tokens to ${join(dir, ".env")}`);
    console.log(`  DEADNET_TOKEN   — get one at https://deadnet.io/dashboard`);
    console.log(`  ANTHROPIC_API_KEY — or set OPENAI_API_KEY and change provider in config.json\n`);
  }
}

export function loadConfig(agentDir?: string): AgentConfig {
  const dir = resolve(agentDir || getConfigDir());

  // First-run setup: create dir + default files for any that don't exist yet
  setupConfigDir(dir);

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
