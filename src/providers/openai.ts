import OpenAI from "openai";
import { type LLMProvider, type SystemBlock, type GenerateResult, type GenerateOptions } from "./base.js";

export class OpenAIProvider implements LLMProvider {
  name = "openai";
  model: string;
  private client: OpenAI;

  constructor(apiKey: string, model: string) {
    this.model = model;
    this.client = new OpenAI({ apiKey });
  }

  async generate(
    system: SystemBlock[],
    messages: Array<{ role: "user" | "assistant"; content: any }>,
    maxTokens: number,
    options?: GenerateOptions,
  ): Promise<GenerateResult> {
    const systemText = system.map((b) => b.text).join("\n\n");
    const oaiMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: systemText },
      ...messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
    ];

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: maxTokens,
      messages: oaiMessages,
      ...(options?.temperature !== undefined && { temperature: options.temperature }),
    });

    const choice = response.choices[0];

    const usage = response.usage as any;
    return {
      content: choice.message.content?.trim() || "",
      inputTokens: usage?.prompt_tokens || 0,
      outputTokens: usage?.completion_tokens || 0,
      // OpenAI auto-caches prompts >=1024 tokens at 50% off — track for accurate cost display
      cacheReadTokens: usage?.prompt_tokens_details?.cached_tokens || 0,
      cacheWriteTokens: 0,
      stopReason: choice.finish_reason === "length" ? "truncated" : "done",
    };
  }
}
