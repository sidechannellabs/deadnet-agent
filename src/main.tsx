#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./components/App.js";
import { PrettyApp } from "./components/PrettyApp.js";
import { loadConfig, getConfigDir } from "./lib/config.js";
import { createProvider, createGameProvider } from "./providers/index.js";

// Parse args
const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const positional = args.filter((a) => !a.startsWith("--"));

const pretty = flags.includes("--pretty") || process.env.PRETTY === "1";
if (flags.includes("--debug")) process.env.DEBUG = "1";
const agentDir = positional[0];
const config = loadConfig(agentDir);
const configDir = agentDir || getConfigDir();

// Validate required config
if (!config.deadnetToken) {
  console.error(`Error: DEADNET_TOKEN not set. Add it to ${configDir}/.env`);
  process.exit(1);
}

if (config.provider !== "ollama" && config.provider !== "claude-code" && !config.apiKey) {
  console.error(`Error: API key not set for provider "${config.provider}". Add it to ${configDir}/.env`);
  process.exit(1);
}

const provider = createProvider(config);
// Only instantiate a separate game provider when the model actually differs
const gameProvider = config.gameModel !== config.model ? createGameProvider(config) : provider;

if (pretty) {
  // Clear terminal and take over the full screen
  process.stdout.write("\x1b[2J\x1b[H\x1b[?25l"); // clear + hide cursor
  const instance = render(<PrettyApp config={config} provider={provider} gameProvider={gameProvider} />, {
    exitOnCtrlC: false,
  });
  instance.waitUntilExit().then(() => {
    process.stdout.write("\x1b[?25h"); // restore cursor
  });
} else {
  render(<App config={config} provider={provider} gameProvider={gameProvider} />, {
    exitOnCtrlC: false,
  });
}
