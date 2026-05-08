import {
  isKnownProvider
} from "../core/providers/index.js";
import {
  isValidDisplayMode,
  isValidStatusStyle,
  isValidTheme
} from "../shared/constants.js";
import {
  getDisplayToolConfig,
  getToolConfigPath,
  readToolConfig,
  setToolConfigValue,
  unsetToolConfigValue
} from "../claude/settings.js";
import { installClaudeStatusLine, uninstallClaudeStatusLine } from "../claude/install.js";
import { refreshQuotaOnSessionStart } from "../claude/sessionStart.js";
import { checkForUpdates } from "./update.js";
import { getPackageVersion } from "../shared/packageInfo.js";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidBaseUrl(value) {
  if (!isNonEmptyString(value)) {
    return false;
  }

  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

const CONFIG_KEYS = {
  style: {
    property: "style",
    validate: isValidStatusStyle,
    invalidMessage: "Invalid style. Use: text, compact, or bar."
  },
  display: {
    property: "displayMode",
    validate: isValidDisplayMode,
    invalidMessage: "Invalid display. Use: left or used."
  },
  theme: {
    property: "theme",
    validate: isValidTheme,
    invalidMessage: "Invalid theme. Use: dark, light, or mono."
  },
  ctx: {
    property: "ctxEnabled",
    validate: (v) => v === "on" || v === "off",
    invalidMessage: "Invalid ctx. Use: on or off.",
    transform: (v) => v === "on"
  },
  "auth-token": {
    property: "authToken",
    validate: isNonEmptyString,
    invalidMessage: "Invalid auth-token. Provide a non-empty token.",
    displayValue: "<stored>"
  },
  "base-url": {
    property: "baseUrl",
    validate: isValidBaseUrl,
    invalidMessage:
      "Invalid base-url. Provide a full URL such as https://open.bigmodel.cn/api/anthropic."
  },
  provider: {
    property: "provider",
    validate: isKnownProvider,
    invalidMessage: "Invalid provider. Use: glm or minimax."
  }
};

export async function handleCommand(args, output = process.stdout, dependencies = {}) {
  const getVersion = dependencies.getVersion || getPackageVersion;
  const runUpdateCheck = dependencies.runUpdateCheck || checkForUpdates;
  const [command, subcommand, key, value] = args.positionals;

  if (command === "version") {
    output.write(`model-statusline ${await getVersion()}\n`);
    return true;
  }

  if (command === "check-update") {
    const result = await runUpdateCheck();
    output.write(`model-statusline ${result.currentVersion}\n`);

    if (result.status === "up-to-date") {
      output.write(`latest: ${result.latestVersion}\nstatus: up to date\n`);
      return true;
    }

    if (result.status === "update-available") {
      output.write(
        `latest: ${result.latestVersion}\nstatus: update available\nupgrade: ${result.upgradeCommand}\n`
      );
      return true;
    }

    output.write(`status: unable to check updates\nreason: ${result.errorMessage}\n`);
    return true;
  }

  if (command === "install") {
    const result = await installClaudeStatusLine(undefined, undefined, undefined, {
      force: Boolean(args.force)
    });
    if (!result.installed && result.reason === "unmanaged_exists") {
      output.write(
        `Skipped install because Claude Code already has an unmanaged statusLine.\nsettings: ${result.settingsPath}\nRun 'model-statusline install --force' to replace it and back it up.\n`
      );
      return true;
    }

    output.write(
      `Installed Claude Code status line and SessionStart hooks.\nsettings: ${result.settingsPath}\nstatusLine: ${result.command}\nsessionStart: ${result.sessionStartHookCommand}\n`
    );
    return true;
  }

  if (command === "uninstall") {
    const result = await uninstallClaudeStatusLine();
    if (result.removed) {
      output.write(`Removed Claude Code status line.\nsettings: ${result.settingsPath}\n`);
      return true;
    }

    if (result.reason === "unmanaged") {
      output.write(
        `Skipped uninstall because current statusLine is not managed by model-statusline.\nsettings: ${result.settingsPath}\n`
      );
      return true;
    }

    output.write(`No Claude Code status line was configured.\nsettings: ${result.settingsPath}\n`);
    return true;
  }

  if (command === "session-start-refresh") {
    try {
      await refreshQuotaOnSessionStart();
    } catch {}
    return true;
  }

  if (command === "config" && subcommand === "show") {
    const config = await readToolConfig();
    output.write(`${JSON.stringify(getDisplayToolConfig(config), null, 2)}\n`);
    return true;
  }

  if (command === "config" && subcommand === "set") {
    const configKey = CONFIG_KEYS[key];
    if (!configKey) {
      process.exitCode = 1;
      output.write("Supported config keys: style, display, theme, ctx, auth-token, base-url, provider\n");
      return true;
    }

    if (!configKey.validate(value)) {
      process.exitCode = 1;
      output.write(`${configKey.invalidMessage}\n`);
      return true;
    }

    // Store auth-token/base-url under provider-specific key (--provider flag takes priority)
    let storeKey = configKey.property;
    if (configKey.property === "authToken" || configKey.property === "baseUrl") {
      const providerName = args.provider || (await readToolConfig()).provider || "glm";
      storeKey = `${configKey.property}_${providerName}`;
    }

    const config = await setToolConfigValue(
      storeKey,
      configKey.transform ? configKey.transform(value) : value
    );
    output.write(
      `Saved ${key}=${configKey.displayValue || config[storeKey]}\nconfig: ${getToolConfigPath()}\n`
    );
    return true;
  }

  if (command === "config" && subcommand === "unset") {
    const configKey = CONFIG_KEYS[key];
    if (!configKey) {
      process.exitCode = 1;
      output.write("Supported config keys: style, display, theme, ctx, auth-token, base-url, provider\n");
      return true;
    }

    let storeKey = configKey.property;
    if (configKey.property === "authToken" || configKey.property === "baseUrl") {
      const providerName = args.provider || (await readToolConfig()).provider || "glm";
      storeKey = `${configKey.property}_${providerName}`;
    }

    await unsetToolConfigValue(storeKey);
    output.write(`Removed ${key}\nconfig: ${getToolConfigPath()}\n`);
    return true;
  }

  if (command === "config") {
    process.exitCode = 1;
    output.write("Supported config subcommands: show, set, unset\n");
    return true;
  }

  if (command) {
    process.exitCode = 1;
    output.write(`Unknown command: ${command}\nRun 'model-statusline -h' for usage.\n`);
    return true;
  }

  return false;
}
