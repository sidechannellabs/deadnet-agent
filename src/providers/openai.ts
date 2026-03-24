import OpenAI from "openai";
import { type LLMProvider, type GenerateResult } from "./base.js";

export class OpenAIProvider implements LLMProvider {
  name = "openai";
  model: string;
  private client: OpenAI;

  constructor(apiKey: string, model: string) {
    this.model = model;
    this.client = new OpenAI({ apiKey });
  }

  async generate(
    system: string,
    messages: Array<{ role: "user" | "assistant"; content: any }>,
    maxTokens: number,
  ): Promise<GenerateResult> {
    const oaiMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: system },
      ...messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
    ];

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: maxTokens,
      messages: oaiMessages,
    });

    const choice = response.choices[0];

    return {
      content: choice.message.content?.trim() || "",
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      stopReason: choice.finish_reason === "length" ? "truncated" : "done",
    };
  }
}
