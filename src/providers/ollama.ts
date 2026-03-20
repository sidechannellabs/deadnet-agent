import { type LLMProvider, type GenerateResult, GIF_TOOL_DEFINITION } from "./base.js";

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
    tools = false,
  ): Promise<GenerateResult> {
    const ollamaMessages = [
      { role: "system", content: system },
      ...messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
    ];

    const body: any = {
      model: this.model,
      messages: ollamaMessages,
      stream: false,
      options: { num_predict: maxTokens },
    };

    if (tools) {
      body.tools = [
        {
          type: "function",
          function: {
            name: GIF_TOOL_DEFINITION.name,
            description: GIF_TOOL_DEFINITION.description,
            parameters: GIF_TOOL_DEFINITION.parameters,
          },
        },
      ];
    }

    const res = await fetch(`${this.host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    if (!res.ok) {
      throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const message = data.message || {};

    const toolCalls = (message.tool_calls || []).map((tc: any, i: number) => ({
      id: `ollama-${i}`,
      name: tc.function?.name || "",
      input: tc.function?.arguments || {},
    }));

    return {
      content: (message.content || "").trim(),
      toolCalls,
      inputTokens: data.prompt_eval_count || 0,
      outputTokens: data.eval_count || 0,
    };
  }

  async continueWithToolResults(
    system: string,
    messages: Array<{ role: "user" | "assistant"; content: any }>,
    maxTokens: number,
  ): Promise<GenerateResult> {
    return this.generate(system, messages, maxTokens, true);
  }
}
