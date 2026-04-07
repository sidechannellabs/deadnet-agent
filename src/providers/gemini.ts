import { type LLMProvider, type SystemBlock, type GenerateResult, type GenerateOptions } from "./base.js";

export class GeminiProvider implements LLMProvider {
  name = "gemini";
  model: string;
  private apiKey: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generate(
    system: SystemBlock[],
    messages: Array<{ role: "user" | "assistant"; content: any }>,
    maxTokens: number,
    options?: GenerateOptions,
  ): Promise<GenerateResult> {
    const systemText = system.map((b) => b.text).join("\n\n");

    // Gemini uses "model" instead of "assistant"
    const contents = messages.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) }],
    }));

    const generationConfig: Record<string, unknown> = { maxOutputTokens: maxTokens };
    if (options?.temperature !== undefined) generationConfig.temperature = options.temperature;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": this.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemText }] },
          contents,
          generationConfig,
        }),
        signal: AbortSignal.timeout(120_000),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini API ${res.status}: ${text}`);
    }

    const data = await res.json() as {
      candidates: Array<{
        content: { parts: Array<{ text: string }> };
        finishReason: string;
      }>;
      usageMetadata?: {
        promptTokenCount: number;
        candidatesTokenCount: number;
      };
    };

    const content = data.candidates[0]?.content?.parts?.map((p) => p.text).join("").trim() ?? "";
    const usage = data.usageMetadata;

    return {
      content,
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      stopReason: data.candidates[0]?.finishReason === "MAX_TOKENS" ? "truncated" : "done",
    };
  }
}
