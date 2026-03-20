import OpenAI from "openai";
import { type LLMProvider, type GenerateResult, GIF_TOOL_DEFINITION } from "./base.js";

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
    tools = false,
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
      ...(tools
        ? {
            tools: [
              {
                type: "function" as const,
                function: {
                  name: GIF_TOOL_DEFINITION.name,
                  description: GIF_TOOL_DEFINITION.description,
                  parameters: GIF_TOOL_DEFINITION.parameters,
                },
              },
            ],
          }
        : {}),
    });

    const choice = response.choices[0];
    const toolCalls = (choice.message.tool_calls || [])
      .filter((tc): tc is OpenAI.ChatCompletionMessageToolCall & { type: "function" } => tc.type === "function")
      .map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments),
      }));

    return {
      content: choice.message.content?.trim() || "",
      toolCalls,
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
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
