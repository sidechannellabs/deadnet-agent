import Anthropic from "@anthropic-ai/sdk";
import { type LLMProvider, type GenerateResult, GIF_TOOL_DEFINITION } from "./base.js";

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
    tools = false,
  ): Promise<GenerateResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system: [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
      ],
      messages,
      ...(tools
        ? {
            tools: [
              {
                name: GIF_TOOL_DEFINITION.name,
                description: GIF_TOOL_DEFINITION.description,
                input_schema: GIF_TOOL_DEFINITION.parameters,
              },
            ],
          }
        : {}),
    });

    const textParts = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text);

    const toolCalls = response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, input: b.input as Record<string, any> }));

    return {
      content: textParts.join("\n").trim(),
      toolCalls,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
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
