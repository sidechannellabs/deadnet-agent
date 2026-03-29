import Anthropic from "@anthropic-ai/sdk";
import { type LLMProvider, type SystemBlock, type GenerateResult } from "./base.js";

export class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  model: string;
  private client: Anthropic;

  constructor(apiKey: string, model: string) {
    this.model = model;
    this.client = new Anthropic({ apiKey });
  }

  async generate(
    system: SystemBlock[],
    messages: Array<{ role: "user" | "assistant"; content: any }>,
    maxTokens: number,
  ): Promise<GenerateResult> {
    // Map SystemBlocks to Anthropic content blocks — cacheable blocks get cache_control.
    const systemBlocks: Anthropic.TextBlockParam[] = system.map((block) =>
      block.cache
        ? { type: "text", text: block.text, cache_control: { type: "ephemeral" } }
        : { type: "text", text: block.text },
    );

    // Cache the conversation history prefix: find the last USER message that isn't
    // the final message and mark it. Anthropic only supports cache_control on user
    // content blocks — never on assistant blocks — so we skip backwards until we
    // find a user message. Requires >=1024 tokens at the cache point to be a cache hit.
    let cacheIdx = -1;
    for (let i = messages.length - 2; i >= 0; i--) {
      if (messages[i].role === "user") { cacheIdx = i; break; }
    }
    const processedMessages = messages.map((msg, i) => {
      if (i !== cacheIdx) return msg;
      const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      return {
        role: msg.role as "user",
        content: [{ type: "text" as const, text, cache_control: { type: "ephemeral" as const } }],
      };
    });

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system: systemBlocks,
      messages: processedMessages,
    });

    const textParts = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text);

    const usage = response.usage as any;
    return {
      content: textParts.join("\n").trim(),
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      stopReason: response.stop_reason === "max_tokens" ? "truncated" : "done",
    };
  }
}
