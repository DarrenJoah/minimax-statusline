import {
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_CN_BASE_URL,
  DEFAULT_INTL_BASE_URL,
  DEFAULT_QUOTA_URL,
  DEFAULT_TIMEOUT_MS
} from "../../shared/constants.js";
import { asFiniteNumber } from "./utils.js";

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
        Authorization: config.authorization
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
  return /authorization|auth|token/i.test(value);
}

function isRateLimitedMessage(value) {
  if (typeof value !== "string") return false;
  return /rate\s*limit|too many requests|too frequent|frequency|限流|频率|稍后再试/i.test(value);
}

function clampPercent(value) {
  const percent = asFiniteNumber(value);
  if (percent === null) return null;
  return Math.min(100, Math.max(0, percent));
}

function computePercentages(limit) {
  const usage = asFiniteNumber(limit?.usage);
  const remaining = asFiniteNumber(limit?.remaining);
  const currentValue = asFiniteNumber(limit?.currentValue);
  const totalFromParts =
    remaining !== null && currentValue !== null ? remaining + currentValue : null;
  const total = totalFromParts !== null && totalFromParts > 0 ? totalFromParts : usage;

  if (total !== null && total > 0) {
    if (remaining !== null && remaining >= 0 && remaining <= total) {
      const leftPercent = clampPercent(Math.round((remaining / total) * 100));
      if (leftPercent !== null) {
        return { leftPercent, usedPercent: 100 - leftPercent };
      }
    }
    if (currentValue !== null && currentValue >= 0 && currentValue <= total) {
      const usedPercent = clampPercent(Math.round((currentValue / total) * 100));
      if (usedPercent !== null) {
        return { leftPercent: 100 - usedPercent, usedPercent };
      }
    }
  }

  const usedPercent = clampPercent(limit?.percentage);
  if (usedPercent === null) return null;
  return { leftPercent: 100 - usedPercent, usedPercent };
}

function normalizeTokenQuota(key, limit) {
  const percentages = computePercentages(limit);
  if (!percentages) return null;
  const nextResetTime = asFiniteNumber(limit?.nextResetTime);
  return {
    key,
    leftPercent: percentages.leftPercent,
    usedPercent: percentages.usedPercent,
    ...(nextResetTime !== null ? { nextResetTime } : {})
  };
}

function sortTokenLimitsByResetTime(limits) {
  return [...limits].sort((left, right) => {
    const leftReset = asFiniteNumber(left?.nextResetTime);
    const rightReset = asFiniteNumber(right?.nextResetTime);
    if (leftReset !== null && rightReset !== null && leftReset !== rightReset) {
      return leftReset - rightReset;
    }
    if (leftReset !== null && rightReset === null) return -1;
    if (leftReset === null && rightReset !== null) return 1;
    return (left?._index ?? 0) - (right?._index ?? 0);
  });
}

function pickSecondaryTokenLimit(tokenLimits, primaryLimit) {
  const candidates = tokenLimits.filter((l) => l?._index !== primaryLimit?._index);
  if (candidates.length === 0) return null;
  return sortTokenLimitsByResetTime(candidates)[0] ?? null;
}

function pickPrimaryAndSecondaryTokenLimits(limits) {
  const tokenLimits = limits
    .filter((limit) => limit?.type === "TOKENS_LIMIT")
    .map((limit, index) => ({ ...limit, _index: index }));
  if (tokenLimits.length === 0) return [];
  const explicitFiveHour = tokenLimits.find((limit) => limit?.number === 5) ?? null;
  if (explicitFiveHour) {
    const weekCandidate = pickSecondaryTokenLimit(tokenLimits, explicitFiveHour);
    return [explicitFiveHour, weekCandidate].filter(Boolean);
  }
  if (tokenLimits.length === 1) return tokenLimits;
  return sortTokenLimitsByResetTime(tokenLimits).slice(0, 2);
}

function buildMcpQuota(limits) {
  const mcpLimit = limits.find(
    (limit) => limit?.type === "MCP_LIMIT" || limit?.type === "TIME_LIMIT"
  );
  if (!mcpLimit) return null;
  const percentages = computePercentages(mcpLimit);
  if (!percentages) return null;
  const nextResetTime = asFiniteNumber(mcpLimit?.nextResetTime);
  return {
    key: "mcp",
    leftPercent: percentages.leftPercent,
    usedPercent: percentages.usedPercent,
    ...(nextResetTime !== null ? { nextResetTime } : {})
  };
}

function buildTokenQuotas(limits) {
  const selectedLimits = pickPrimaryAndSecondaryTokenLimits(limits);
  if (selectedLimits.length === 0) return [];
  const quotas = [];
  const [fiveHourLimit, weekLimit] = selectedLimits;
  const fiveHourQuota = normalizeTokenQuota("token_5h", fiveHourLimit);
  if (fiveHourQuota) quotas.push(fiveHourQuota);
  const weekQuota = normalizeTokenQuota("token_week", weekLimit);
  if (weekQuota) quotas.push(weekQuota);
  return quotas;
}

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
  if (payload.success !== true) {
    if (payload.code === 1001 || payload.code === 401 || isAuthFailureMessage(payload.msg)) {
      return { kind: "auth_error" };
    }
    if (isRateLimitedMessage(payload.msg)) {
      return { kind: "rate_limited" };
    }
    return { kind: "unavailable" };
  }
  const level = typeof payload.data?.level === "string" ? payload.data.level : "";
  const limits = Array.isArray(payload.data?.limits) ? payload.data.limits : [];
  const quotas = buildTokenQuotas(limits);
  if (quotas.length === 0) {
    return { kind: "unavailable" };
  }
  const primaryQuota = quotas[0];
  const mcp = buildMcpQuota(limits);
  return {
    kind: "success",
    level,
    display: "percent",
    leftPercent: primaryQuota.leftPercent,
    usedPercent: primaryQuota.usedPercent,
    ...(Number.isFinite(primaryQuota.nextResetTime)
      ? { nextResetTime: primaryQuota.nextResetTime }
      : {}),
    primaryQuotaKey: primaryQuota.key,
    quotas,
    ...(mcp ? { mcp } : {})
  };
}

// ─── provider ────────────────────────────────────────────────────────────────

function deriveQuotaUrl(baseUrl) {
  if (!baseUrl) return "";
  try {
    const host = new URL(baseUrl).host;
    if (host.includes("api.z.ai")) {
      return `${DEFAULT_INTL_BASE_URL}/api/monitor/usage/quota/limit`;
    }
    if (
      host.includes("open.bigmodel.cn") ||
      host.includes("dev.bigmodel.cn") ||
      host === "bigmodel.cn" ||
      host.endsWith(".bigmodel.cn")
    ) {
      return `${DEFAULT_CN_BASE_URL}/api/monitor/usage/quota/limit`;
    }
  } catch {}
  return "";
}

export const glm = {
  name: "glm",
  displayName: "GLM",
  quotaUrl: null, // derived from base-url
  authKey: "ANTHROPIC_AUTH_TOKEN",
  baseUrlKey: "ANTHROPIC_BASE_URL",

  deriveQuotaUrl,

  fetch(config, fetchImpl) {
    return fetchQuota(config, fetchImpl);
  },

  parse(response) {
    return parseQuotaResponse(response);
  },

  loadConfig(env, overrides = {}) {
    const authorization =
      overrides.authToken ||
      env[this.authKey] ||
      env.ANTHROPIC_AUTH_TOKEN;
    const anthropicBaseUrl =
      overrides.baseUrl ||
      env[this.baseUrlKey] ||
      env.ANTHROPIC_BASE_URL;
    const derivedQuotaUrl = deriveQuotaUrl(anthropicBaseUrl);
    return {
      quotaUrl: derivedQuotaUrl || DEFAULT_QUOTA_URL,
      authorization,
      anthropicBaseUrl,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      cacheTtlMs: DEFAULT_CACHE_TTL_MS
    };
  }
};
