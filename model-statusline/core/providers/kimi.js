import {
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_TIMEOUT_MS
} from "../../shared/constants.js";
import { asFiniteNumber } from "./utils.js";

const KIMI_API_BASE = "https://api.moonshot.cn";
const KIMI_BALANCE_URL = `${KIMI_API_BASE}/v1/users/me/balance`;

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

/**
 * Kimi (Moonshot) response shape (from /v1/users/me/balance):
 * {
 *   code: 0,
 *   data: {
 *     available_balance: number,   // CNY
 *     voucher_balance: number,
 *     cash_balance: number
 *   },
 *   scode: "0x0",
 *   status: true
 * }
 *
 * Unlike token-quota providers, Kimi returns monetary balance.
 * We normalise available_balance to a "balance" field (CNY string).
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

  if (payload.error) {
    return { kind: "unavailable" };
  }

  const balance = asFiniteNumber(payload.data?.available_balance);
  if (balance === null) {
    return { kind: "unavailable" };
  }

  // For display, we normalise balance as a "remaining quota" indicator.
  // Since no total credit is available, we use the raw CNY value.
  const balanceText = balance.toFixed(2);

  return {
    kind: "success",
    level: "",
    display: "balance",
    leftPercent: null,
    usedPercent: null,
    balance,
    balanceText,
    primaryQuotaKey: "balance",
    quotas: [
      {
        key: "balance",
        leftPercent: null,
        usedPercent: null,
        balance,
        balanceText
      }
    ]
  };
}

// ─── provider ──────────────────────────────────────────────────────────────────

export const kimi = {
  name: "kimi",
  displayName: "Kimi",
  quotaUrl: KIMI_BALANCE_URL,
  authKey: "KIMI_AUTH_TOKEN",
  baseUrlKey: undefined,

  deriveQuotaUrl() {
    return KIMI_BALANCE_URL;
  },

  fetch(config, fetchImpl) {
    return fetchQuota(config, fetchImpl);
  },

  parse(response) {
    return parseQuotaResponse(response);
  },

  loadConfig(env, overrides = {}) {
    const authorization =
      overrides.authToken || env[this.authKey] || env.MOONSHOT_API_KEY;
    return {
      quotaUrl: KIMI_BALANCE_URL,
      authorization,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      cacheTtlMs: DEFAULT_CACHE_TTL_MS
    };
  }
};
