import {
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_TIMEOUT_MS
} from "../../shared/constants.js";
import { asFiniteNumber } from "./utils.js";

const MINIMAX_INTL_API_BASE = "https://www.minimax.io";
const MINIMAX_INTL_QUOTA_URL = `${MINIMAX_INTL_API_BASE}/v1/token_plan/remains`;

// ─── fetch ─────────────────────────────────────────────────────────────────────────

export async function fetchQuota(config, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    return { kind: "unavailable" };
  }

  try {
    const response = await fetchImpl(config.quotaUrl, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        Authorization: `Bearer ${config.authorization}`
      },
      signal: AbortSignal.timeout(config.timeoutMs)
    });

    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}

    return { kind: "response", status: response.status, json, text };
  } catch {
    return { kind: "unavailable" };
  }
}

// ─── parse ────────────────────────────────────────────────────────────────────

function isAuthFailureMessage(value) {
  if (typeof value !== "string") return false;
  return /authorization|auth|token|unauthorized|401/i.test(value);
}

function isRateLimitedMessage(value) {
  if (typeof value !== "string") return false;
  return /rate\s*limit|too many requests|too frequent/i.test(value);
}

function clampPercent(value) {
  const percent = asFiniteNumber(value);
  if (percent === null) return null;
  return Math.min(100, Math.max(0, percent));
}

/**
 * MiniMax International response shape (from /v1/api/openplatform/coding_plan/remains):
 * Same structure as CN version — uses model_remains array.
 * Each model: { model_name, current_interval_usage_count, current_interval_total_count, ... }
 */
export function parseQuotaResponse(response) {
  if (!response || response.kind !== "response") {
    return { kind: "unavailable" };
  }

  if (response.status === 429 || isRateLimitedMessage(response.text)) {
    return { kind: "rate_limited" };
  }

  const payload = response.json;
  if (!payload || typeof payload !== "object") {
    return { kind: "unavailable" };
  }

  if (isAuthFailureMessage(response.text) || payload.code === 401) {
    return { kind: "auth_error" };
  }

  const modelRemains = Array.isArray(payload.model_remains)
    ? payload.model_remains
    : [];

  if (modelRemains.length === 0) {
    return { kind: "unavailable" };
  }

  // Primary: MiniMax-M* model
  const primary = modelRemains.find((m) => m.model_name === "MiniMax-M*") || modelRemains[0];
  const total = asFiniteNumber(primary?.current_interval_total_count);
  // current_interval_usage_count IS the used count (consumed requests)
  const used = asFiniteNumber(primary?.current_interval_usage_count);
  // remains_time is in milliseconds
  const remainsTimeMs = asFiniteNumber(primary?.remains_time);

  let leftPercent = null;
  let usedPercent = null;
  let nextResetTime = null;

  if (total !== null && total > 0) {
    const safeUsed = used !== null && used >= 0 ? used : 0;
    const remaining = total - safeUsed;
    leftPercent = clampPercent(Math.round((remaining / total) * 100));
    usedPercent = clampPercent(Math.round((safeUsed / total) * 100));
  }

  if (remainsTimeMs !== null && remainsTimeMs > 0) {
    nextResetTime = Date.now() + remainsTimeMs;
  }

  if (leftPercent === null) {
    return { kind: "unavailable" };
  }

  // Build per-model quotas (INTL returns multiple models)
  // Filter: only MiniMax-M* (no music/audio/coding-plan variants)
  const quotas = modelRemains
    .filter((m) => {
      const t = asFiniteNumber(m?.current_interval_total_count);
      const name = m.model_name || "";
      return t !== null && t > 0 && name === "MiniMax-M*";
    })
    .map((m) => {
      const t = asFiniteNumber(m.current_interval_total_count);
      const u = asFiniteNumber(m.current_interval_usage_count);
      const safeU = u !== null && u >= 0 ? u : 0;
      const rem = t - safeU;
      const remMs = asFiniteNumber(m.remains_time);
      const resetTs = remMs !== null && remMs > 0 ? Date.now() + remMs : null;
      return {
        key: "token_5h",
        leftPercent: clampPercent(Math.round((rem / t) * 100)),
        usedPercent: clampPercent(Math.round((safeU / t) * 100)),
        ...(resetTs !== null ? { nextResetTime: resetTs } : {})
      };
    });

  return {
    kind: "success",
    level: "",
    display: "percent",
    leftPercent: leftPercent ?? 0,
    usedPercent: usedPercent ?? 0,
    primaryQuotaKey: "token_5h",
    quotas,
    ...(nextResetTime !== null ? { nextResetTime } : {})
  };
}

// ─── provider ──────────────────────────────────────────────────────────────────

export const minimaxIntl = {
  name: "minimax-intl",
  displayName: "MiniMax INTL",
  region: "intl",
  quotaUrl: MINIMAX_INTL_QUOTA_URL,
  authKey: "MINIMAX_INTL_KEY",
  baseUrlKey: undefined,

  deriveQuotaUrl() {
    return MINIMAX_INTL_QUOTA_URL;
  },

  fetch(config, fetchImpl) {
    return fetchQuota(config, fetchImpl);
  },

  parse(response) {
    return parseQuotaResponse(response);
  },

  loadConfig(env, overrides = {}) {
    const authorization =
      overrides.authToken || env[this.authKey];
    return {
      quotaUrl: MINIMAX_INTL_QUOTA_URL,
      authorization,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      cacheTtlMs: DEFAULT_CACHE_TTL_MS
    };
  }
};
