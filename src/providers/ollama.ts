import { type LLMProvider, type GenerateResult } from "./base.js";

export class OllamaProvider implements LLMProvider {
  name = "ollama";
  model: string;
  private host: string;

  constructor(host: string, model: string) {
    this.model = model;
    this.host = host.replace(/\/$/, "");
  }

  async generate(
    system: string,
    messages: Array<{ role: "user" | "assistant"; content: any }>,
    maxTokens: number,
  ): Promise<GenerateResult> {
    const ollamaMessages = [
      { role: "system", content: system },
      ...messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
    ];

    const res = await fetch(`${this.host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: ollamaMessages,
        stream: false,
        options: { num_predict: maxTokens },
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!res.ok) {
      throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const message = data.message || {};

    return {
      content: (message.content || "").trim(),
      inputTokens: data.prompt_eval_count || 0,
      outputTokens: data.eval_count || 0,
      stopReason: data.done_reason === "length" ? "truncated" : "done",
    };
  }
}
