import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_CTX_ENABLED,
  DEFAULT_DISPLAY_MODE,
  DEFAULT_STYLE,
  DEFAULT_THEME,
  DEFAULT_TIMEOUT_MS
} from "./constants.js";
import { getProvider } from "../core/providers/index.js";

export function normalizeOptionalString(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function getCacheRoot() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Caches");
  }

  if (process.platform === "win32") {
    return process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  }

  return process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
}

export async function loadConfig(env = process.env, overrides = {}, options = {}) {
  const providerName = overrides.provider || env.PROVIDER || "glm";
  const provider = getProvider(providerName);

  // Resolve provider-specific auth token and base url
  const providerOverrides = {
    ...overrides,
    authToken: overrides[`authToken_${providerName}`] || overrides.authToken,
    baseUrl: overrides[`baseUrl_${providerName}`] || overrides.baseUrl
  };

  const { quotaUrl, authorization, anthropicBaseUrl } = provider.loadConfig(env, providerOverrides);

  const tokenHash = authorization
    ? crypto.createHash("sha256").update(authorization).digest("hex").slice(0, 12)
    : "anonymous";

  return {
    provider,
    quotaUrl,
    authorization,
    anthropicBaseUrl,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    cacheTtlMs: DEFAULT_CACHE_TTL_MS,
    displayMode: DEFAULT_DISPLAY_MODE,
    style: DEFAULT_STYLE,
    theme: DEFAULT_THEME,
    ctxEnabled: DEFAULT_CTX_ENABLED,
    cacheFilePath: path.join(getCacheRoot(), "model-statusline", `cache-${providerName}-${tokenHash}.json`)
  };
}
