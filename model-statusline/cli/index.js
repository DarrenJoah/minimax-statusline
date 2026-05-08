#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";

import { handleCommand } from "./commands.js";
import { parseArgs } from "./args.js";
import { loadConfig } from "../shared/config.js";
import { formatStatus } from "../core/status/format.js";
import { formatQueryHuman } from "../core/query/format.js";
import { readStatusLineInput } from "../claude/input.js";
import { normalizeContextWindow } from "../claude/contextWindow.js";
import { readToolConfig } from "../claude/settings.js";
import { resolveQuotaStatus } from "../core/quota/service.js";
import { getPackageVersion } from "../shared/packageInfo.js";
import {
  isValidDisplayMode,
  isValidStatusStyle,
  isValidTheme,
  normalizeDisplayMode
} from "../shared/constants.js";

function printHelp() {
  process.stdout.write(`model-statusline

Usage:
  model-statusline [--display left|used]
  model-statusline [--style text|compact|bar] [--theme dark|light|mono] [--ctx on|off]
  model-statusline [--provider glm|minimax]
  model-statusline --version
  model-statusline install [--force]
  model-statusline uninstall
  model-statusline version
  model-statusline check-update
  model-statusline config set style <text|compact|bar>
  model-statusline config set display <left|used>
  model-statusline config set theme <dark|light|mono>
  model-statusline config set ctx <on|off>
  model-statusline config set auth-token <token>
  model-statusline config set base-url <url>
  model-statusline config set provider <glm|minimax>
  model-statusline config unset <style|display|theme|ctx|auth-token|base-url|provider>
  model-statusline config show

When run without arguments, displays comprehensive quota usage (5h, week, MCP)
with full reset dates. Use --display to choose left or used metric.

When used as a Claude Code status line, displays a compact one-line status bar.

Commands:
  install                 Install model-statusline into Claude Code statusLine.command and SessionStart hooks.
  install --force         Replace an existing unmanaged status line and back it up.
  uninstall               Remove the managed status line and SessionStart hooks, and restore a backup if one exists.
  version                 Print the installed model-statusline version.
  check-update            Check npm for a newer version and print the upgrade command.
  config show             Print the current persisted config. Stored tokens are redacted.
  config set ...          Persist a display option or manual credential override.
  config unset ...        Remove one persisted config key.

Options:
  --style                 Output layout: text, compact, or bar (status line mode only).
  --display               Quota metric: left or used.
  --theme                 Theme preset: dark, light, or mono (status line mode only).
  --ctx on|off            Show context window usage (default: on, status line mode only).
  --force                 Allow install to replace an unmanaged Claude status line.
  -v, --version           Show the installed version.
  -h, --help              Show this help text.

Examples:
  model-statusline
  model-statusline --display used
  model-statusline --version
  model-statusline check-update
  model-statusline config set display used
  model-statusline config set theme light
  model-statusline config set ctx on
  model-statusline config set auth-token <your-real-token>
  model-statusline install

Environment:
  ANTHROPIC_AUTH_TOKEN
  ANTHROPIC_BASE_URL
`);
}

function getStoredDisplayOverrides(userConfig) {
  return {
    ...(isValidStatusStyle(userConfig.style) ? { style: userConfig.style } : {}),
    ...(isValidDisplayMode(userConfig.displayMode) ? { displayMode: userConfig.displayMode } : {}),
    ...(isValidTheme(userConfig.theme) ? { theme: userConfig.theme } : {}),
    ...(userConfig.ctxEnabled === false ? { ctxEnabled: false } : {})
  };
}

// Read fresh env from settings.json so model switches take effect immediately
function readClaudeSettings() {
  try {
    const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
    const raw = fsSync.readFileSync(settingsPath, "utf8");
    const settings = JSON.parse(raw);
    return {
      env: settings?.env && typeof settings.env === "object" ? settings.env : {},
      model: settings?.env?.ANTHROPIC_MODEL || settings?.ANTHROPIC_MODEL || ""
    };
  } catch {
    return { env: {}, model: "" };
  }
}

function detectProviderFromModel(model) {
  if (!model) return null;
  const lower = model.toLowerCase();
  if (lower.includes("minimax")) return "minimax-intl";
  if (lower.includes("glm")) return "glm";
  if (lower.includes("moonshot") || lower.includes("kimi")) return "kimi";
  return null;
}

export async function main() {
  try {
    const args = parseArgs();
    if (args.help) {
      printHelp();
      return;
    }

    if (args.version) {
      process.stdout.write(`model-statusline ${await getPackageVersion()}\n`);
      return;
    }

    if (await handleCommand(args)) {
      return;
    }

    const statusLineInput = await readStatusLineInput();
    const userConfig = await readToolConfig();
    // Read fresh settings so env vars (token, base URL) reflect model switches
    const claudeSettings = readClaudeSettings();
    const freshEnv = { ...process.env, ...claudeSettings.env };
    const autoDetectedProvider = detectProviderFromModel(claudeSettings.model);
    const effectiveProvider = args.provider || autoDetectedProvider || userConfig.provider;
    const mergedOverrides = { ...userConfig, ...args, provider: effectiveProvider };
    const loadedConfig = await loadConfig(freshEnv, mergedOverrides);
    const config = {
      ...loadedConfig,
      ...getStoredDisplayOverrides(userConfig),
      ...args,
      provider: loadedConfig.provider,
      sessionId: statusLineInput?.session_id || ""
    };
    const quotaStatus = await resolveQuotaStatus(config);

    if (!statusLineInput) {
      const displayMode = normalizeDisplayMode(
        isValidDisplayMode(args.displayMode) ? args.displayMode : userConfig.displayMode
      );
      process.stdout.write(
        formatQueryHuman(quotaStatus, displayMode, config.provider.displayName)
      );
      return;
    }

    const ctxModel = config.ctxEnabled !== false
      ? normalizeContextWindow(statusLineInput)
      : null;

    process.stdout.write(
      `${formatStatus(quotaStatus, {
        displayMode: config.displayMode,
        style: config.style,
        theme: config.theme,
        ctxModel,
        displayName: config.provider.displayName,
        compactLabel: config.provider.displayName
      })}\n`
    );
  } catch {
    process.stdout.write("quota unavailable\n");
  }
}

await main();
