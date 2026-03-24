export type GenerateResult = {
  content: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  stopReason: "done" | "truncated";
};

export interface LLMProvider {
  name: string;
  model: string;
  generate(
    system: string,
    messages: Array<{ role: "user" | "assistant"; content: any }>,
    maxTokens: number,
  ): Promise<GenerateResult>;
}
