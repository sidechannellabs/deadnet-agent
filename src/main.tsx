#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./components/App.js";
import { PrettyApp } from "./components/PrettyApp.js";
import { loadConfig } from "./lib/config.js";
import { createProvider } from "./providers/index.js";

// Parse args
const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const positional = args.filter((a) => !a.startsWith("--"));

const pretty = flags.includes("--pretty");
const agentDir = positional[0] || ".";
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

if (pretty) {
  render(<PrettyApp config={config} provider={provider} />, {
    exitOnCtrlC: false,
  });
} else {
  render(<App config={config} provider={provider} />, {
    exitOnCtrlC: false,
  });
}
