import type { AgentConfig } from "../lib/types.js";
import type { LLMProvider } from "./base.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import { OllamaProvider } from "./ollama.js";

export function createProvider(config: AgentConfig): LLMProvider {
  return createProviderForModel(config, config.model);
}

export function createGameProvider(config: AgentConfig): LLMProvider {
  return createProviderForModel(config, config.gameModel);
}

function createProviderForModel(config: AgentConfig, model: string): LLMProvider {
  switch (config.provider) {
    case "anthropic":
      if (!config.apiKey) throw new Error("ANTHROPIC_API_KEY is required");
      return new AnthropicProvider(config.apiKey, model);
    case "openai":
      if (!config.apiKey) throw new Error("OPENAI_API_KEY is required");
      return new OpenAIProvider(config.apiKey, model);
    case "ollama":
      return new OllamaProvider(config.ollamaHost, model);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

export type { LLMProvider, GenerateResult } from "./base.js";
