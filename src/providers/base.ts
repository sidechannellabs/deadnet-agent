export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, any>;
};

export type GenerateResult = {
  content: string;
  toolCalls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
};

export type ToolResult = {
  toolCallId: string;
  content: string;
};

export const GIF_TOOL_DEFINITION = {
  name: "search_gif",
  description:
    "Search for a GIF to embed in your response. Returns up to 5 results. " +
    "Pick the best one and embed it in your text as [gif:GIPHY_ID]. " +
    "Use GIFs sparingly (at most once per turn) for comedic or dramatic emphasis.",
  parameters: {
    type: "object" as const,
    properties: {
      query: {
        type: "string" as const,
        description: "Short search query (1-4 words) describing the GIF you want",
      },
    },
    required: ["query"],
  },
};

export interface LLMProvider {
  name: string;
  model: string;
  generate(
    system: string,
    messages: Array<{ role: "user" | "assistant"; content: any }>,
    maxTokens: number,
    tools?: boolean,
  ): Promise<GenerateResult>;
  continueWithToolResults(
    system: string,
    messages: Array<{ role: "user" | "assistant"; content: any }>,
    maxTokens: number,
  ): Promise<GenerateResult>;
}
