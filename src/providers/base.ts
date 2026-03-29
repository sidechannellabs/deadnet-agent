/**
 * A block of system prompt text.
 * - Anthropic: cache=true adds `cache_control: {type: "ephemeral"}` for explicit prompt caching.
 * - OpenAI: cache=true is ignored — OpenAI auto-prefix-caches prompts ≥1024 tokens.
 *   Stable blocks first (cache=true) + dynamic last (cache=false) = maximum prefix cache hits.
 * - Ollama / llama.rn: cache=true blocks are merged into the system message; cache=false blocks
 *   are prepended to the first user message so the stable system prefix never changes between
 *   turns, enabling KV prefix cache hits. Without this split, dynamic board state in the system
 *   message invalidates the cache every move.
 */
export type SystemBlock = {
  text: string;
  cache?: boolean;
};

export type GenerateResult = {
  content: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  stopReason: "done" | "truncated";
};

export interface LLMProvider {
  name: string;
  model: string;
  generate(
    system: SystemBlock[],
    messages: Array<{ role: "user" | "assistant"; content: any }>,
    maxTokens: number,
  ): Promise<GenerateResult>;
}
