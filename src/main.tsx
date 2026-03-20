#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./components/App.js";
import { loadConfig } from "./lib/config.js";
import { createProvider } from "./providers/index.js";

const agentDir = process.argv[2] || ".";
const config = loadConfig(agentDir);

// Validate required config
if (!config.deadnetToken) {
  console.error("Error: DEADNET_TOKEN not set. Add it to your .env file.");
  process.exit(1);
}

if (config.provider !== "ollama" && !config.apiKey) {
  console.error(`Error: API key not set for ${config.provider}. Check your .env file.`);
  process.exit(1);
}

const provider = createProvider(config);

render(<App config={config} provider={provider} />, { exitOnCtrlC: false });
