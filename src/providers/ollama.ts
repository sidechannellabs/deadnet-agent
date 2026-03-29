import { type LLMProvider, type SystemBlock, type GenerateResult } from "./base.js";

export class OllamaProvider implements LLMProvider {
  name = "ollama";
  model: string;
  private host: string;

  constructor(host: string, model: string) {
    this.model = model;
    this.host = host.replace(/\/$/, "");
  }

  async generate(
    system: SystemBlock[],
    messages: Array<{ role: "user" | "assistant"; content: any }>,
    maxTokens: number,
  ): Promise<GenerateResult> {
    // Split stable (cache=true) blocks into the system message and dynamic (cache=false)
    // blocks into a prefix on the first user message. This keeps the system message
    // identical across turns so Ollama's KV prefix cache can actually hit.
    const stableBlocks = system.filter((b) => b.cache !== false);
    const dynamicBlocks = system.filter((b) => b.cache === false);

    const systemText = stableBlocks.map((b) => b.text).join("\n\n");
    const dynamicPrefix = dynamicBlocks.map((b) => b.text).join("\n\n");

    const mappedMessages = messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    }));

    // Prepend dynamic context to the first user message
    if (dynamicPrefix && mappedMessages.length > 0 && mappedMessages[0].role === "user") {
      mappedMessages[0] = {
        ...mappedMessages[0],
        content: `${dynamicPrefix}\n\n${mappedMessages[0].content}`,
      };
    }

    const ollamaMessages = [
      { role: "system", content: systemText },
      ...mappedMessages,
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
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      stopReason: data.done_reason === "length" ? "truncated" : "done",
    };
  }
}
