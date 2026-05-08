import {
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_TIMEOUT_MS
} from "../../shared/constants.js";
import { asFiniteNumber } from "./utils.js";

const MINIMAX_API_BASE = "https://www.minimaxi.com";
const MINIMAX_QUOTA_URL = `${MINIMAX_API_BASE}/v1/token_plan/remains`;

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
 * MiniMax response shape (from /v1/token_plan/remains):
 * {
 *   success: true,
 *   data: {
 *     model_remains: [{
 *       current_interval_usage_count: number,
 *       current_interval_total_count: number,
 *       remains_time: { hours, minutes, seconds },
 *       current_weekly_usage_count: number,
 *       current_weekly_total_count: number,
 *       weekly_remains_time: { hours, minutes, seconds },
 *       model_name: string
 *     }]
 *   }
 * }
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

  const modelRemains = Array.isArray(payload.data?.model_remains)
    ? payload.data.model_remains
    : [];

  if (modelRemains.length === 0) {
    return { kind: "unavailable" };
  }

  // Use the first model's data as primary
  const primary = modelRemains[0];
  const total = asFiniteNumber(primary?.current_interval_total_count);
  const used = asFiniteNumber(primary?.current_interval_usage_count);
  const remaining = asFiniteNumber(primary?.remains_time?.hours);

  let leftPercent = null;
  let usedPercent = null;

  if (total !== null && total > 0) {
    if (used !== null && used >= 0) {
      leftPercent = clampPercent(Math.round(((total - used) / total) * 100));
      usedPercent = clampPercent(Math.round((used / total) * 100));
    } else {
      // Fallback: derive from weekly counts
      const weeklyTotal = asFiniteNumber(primary?.current_weekly_total_count);
      const weeklyUsed = asFiniteNumber(primary?.current_weekly_usage_count);
      if (weeklyTotal !== null && weeklyUsed !== null && weeklyTotal > 0) {
        leftPercent = clampPercent(Math.round(((weeklyTotal - weeklyUsed) / weeklyTotal) * 100));
        usedPercent = clampPercent(Math.round((weeklyUsed / weeklyTotal) * 100));
      }
    }
  }

  if (leftPercent === null && usedPercent === null) {
    return { kind: "unavailable" };
  }

  const nextResetTime = remaining !== null
    ? Date.now() + remaining * 60 * 60 * 1000
    : null;

  const weeklyTotal = asFiniteNumber(primary?.current_weekly_total_count);
  const weeklyUsed = asFiniteNumber(primary?.current_weekly_usage_count);
  const weeklyRemaining = asFiniteNumber(primary?.weekly_remains_time?.hours);

  const quotas = [
    {
      key: "token_5h",
      leftPercent: leftPercent ?? 0,
      usedPercent: usedPercent ?? 0,
      ...(nextResetTime !== null ? { nextResetTime } : {})
    }
  ];

  if (weeklyTotal !== null && weeklyUsed !== null && weeklyTotal > 0) {
    const weeklyLeftPercent = clampPercent(
      Math.round(((weeklyTotal - weeklyUsed) / weeklyTotal) * 100)
    );
    const weeklyUsedPercent = clampPercent(
      Math.round((weeklyUsed / weeklyTotal) * 100)
    );
    const weeklyResetTime =
      weeklyRemaining !== null
        ? Date.now() + weeklyRemaining * 60 * 60 * 1000
        : null;

    quotas.push({
      key: "token_week",
      leftPercent: weeklyLeftPercent ?? 0,
      usedPercent: weeklyUsedPercent ?? 0,
      ...(weeklyResetTime !== null ? { nextResetTime: weeklyResetTime } : {})
    });
  }

  return {
    kind: "success",
    level: primary.model_name || "",
    display: "percent",
    leftPercent: leftPercent ?? 0,
    usedPercent: usedPercent ?? 0,
    ...(nextResetTime !== null ? { nextResetTime } : {}),
    primaryQuotaKey: "token_5h",
    quotas
  };
}

// ─── provider ─────────────────────────────────────────────────────────────────

export const minimax = {
  name: "minimax",
  displayName: "MiniMax",
  region: "cn",
  quotaUrl: MINIMAX_QUOTA_URL,
  authKey: "MINIMAX_AUTH_TOKEN",
  baseUrlKey: undefined,

  deriveQuotaUrl() {
    return MINIMAX_QUOTA_URL;
  },

  fetch(config, fetchImpl) {
    return fetchQuota(config, fetchImpl);
  },

  parse(response) {
    return parseQuotaResponse(response);
  },

  loadConfig(env, overrides = {}) {
    const authorization =
      overrides.authToken || env[this.authKey] || env.MINIMAX_API_KEY;
    return {
      quotaUrl: MINIMAX_QUOTA_URL,
      authorization,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      cacheTtlMs: DEFAULT_CACHE_TTL_MS
    };
  }
};
