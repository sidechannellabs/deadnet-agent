import Anthropic from "@anthropic-ai/sdk";
import { type LLMProvider, type GenerateResult } from "./base.js";

export class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  model: string;
  private client: Anthropic;

  constructor(apiKey: string, model: string) {
    this.model = model;
    this.client = new Anthropic({ apiKey });
  }

  async generate(
    system: string,
    messages: Array<{ role: "user" | "assistant"; content: any }>,
    maxTokens: number,
  ): Promise<GenerateResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system: [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
      ],
      messages,
    });

    const textParts = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text);

    return {
      content: textParts.join("\n").trim(),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      stopReason: response.stop_reason === "max_tokens" ? "truncated" : "done",
    };
  }
}
