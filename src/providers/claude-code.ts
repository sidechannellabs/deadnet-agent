import { spawn } from "child_process";
import { type LLMProvider, type SystemBlock, type GenerateResult } from "./base.js";

/**
 * Runs `claude -p` as a subprocess. No API key needed — auth flows through
 * Claude Code's own credentials (`claude auth login`).
 *
 * Limitations vs direct API providers:
 * - No hard maxTokens enforcement (we add a soft hint in the prompt; the DeadNet
 *   backend still enforces the budget and the engine handles over_token_limit retries).
 * - No prompt caching metrics (cacheReadTokens / cacheWriteTokens always 0).
 * - ~1–2s subprocess startup cost per turn (fine for 60–90s turn windows).
 */
export class ClaudeCodeProvider implements LLMProvider {
  name = "claude-code";
  model: string;
  private effort: string;

  constructor(model: string, effort: string) {
    this.model = model;
    this.effort = effort;
  }

  async generate(
    system: SystemBlock[],
    messages: Array<{ role: "user" | "assistant"; content: any }>,
    maxTokens: number,
  ): Promise<GenerateResult> {
    const systemText = system.map((b) => b.text).join("\n\n");
    const prompt = buildPrompt(messages, maxTokens);

    const args = [
      "-p", prompt,
      "--system-prompt", systemText,
      "--model", this.model,
      "--effort", this.effort,
      "--output-format", "json",
      "--tools", "",               // no tools needed — pure text generation
      "--no-session-persistence",  // stateless — we own the history
    ];

    const stdout = await runClaude(args);

    let parsed: any;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new Error(`claude -p returned non-JSON output: ${stdout.slice(0, 200)}`);
    }

    const content = (parsed.result ?? "").trim();
    const usage = parsed.usage ?? {};

    return {
      content,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      stopReason: "done",
    };
  }
}

/**
 * Serialise the structured message array into a flat prompt string.
 * The last message in the array is the current user turn (the instruction to respond).
 * All prior messages are formatted as a conversation transcript above it.
 */
function buildPrompt(
  messages: Array<{ role: "user" | "assistant"; content: any }>,
  maxTokens: number,
): string {
  const toString = (content: any): string =>
    typeof content === "string" ? content : JSON.stringify(content);

  const parts: string[] = [];

  // Conversation history (everything except the final user message)
  const history = messages.slice(0, -1);
  if (history.length > 0) {
    parts.push("[Conversation so far]");
    for (const msg of history) {
      const label = msg.role === "assistant" ? "You" : "Opponent";
      parts.push(`${label}: ${toString(msg.content)}`);
    }
    parts.push("");
  }

  // Current turn instruction (the final user message)
  const last = messages.at(-1);
  if (last) {
    parts.push(toString(last.content));
  }

  // Soft token hint — the backend enforces the hard limit; this nudges the model.
  parts.push(`\n(Keep your response under ${maxTokens} tokens.)`);

  return parts.join("\n");
}

function runClaude(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("error", (err) => {
      if ((err as any).code === "ENOENT") {
        reject(new Error("claude not found in PATH — install Claude Code: https://claude.ai/code"));
      } else {
        reject(err);
      }
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}: ${stderr.slice(0, 300)}`));
      } else {
        resolve(stdout);
      }
    });
  });
}
