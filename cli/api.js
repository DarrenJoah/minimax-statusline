const axios = require("axios");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { getContextWindowSize, getDefaultContextWindowSize } = require('./model-context-sizes');

// ─── Endpoints ────────────────────────────────────────────────────────────────

const MINIMAX_CN_API = "https://www.minimaxi.com";
const MINIMAX_INTL_API = "https://www.minimax.io";
const GLM_CN_API = "https://open.bigmodel.cn";
const GLM_INTL_API = "https://api.z.ai";

const ENDPOINTS = {
  minimax_cn: {
    quota: `${MINIMAX_CN_API}/v1/token_plan/remains`,
    subscription: `${MINIMAX_CN_API}/v1/api/openplatform/charge/combo/cycle_audio_resource_package`,
    billing: `${MINIMAX_CN_API}/account/amount`,
    servername: "minimaxi.com",
  },
  minimax_intl: {
    quota: `${MINIMAX_INTL_API}/v1/token_plan/remains`,
    subscription: `${MINIMAX_INTL_API}/v1/api/openplatform/charge/combo/cycle_audio_resource_package`,
    billing: `${MINIMAX_INTL_API}/account/amount`,
    servername: "minimax.io",
  },
  glm_cn: {
    quota: `${GLM_CN_API}/api/monitor/usage/quota/limit`,
    servername: "open.bigmodel.cn",
  },
  glm_intl: {
    quota: `${GLM_INTL_API}/api/monitor/usage/quota/limit`,
    servername: "api.z.ai",
  },
};

// ─── Quota Parsing ─────────────────────────────────────────────────────────────

function clampPercent(value) {
  const n = Number.isFinite(value) ? value : null;
  if (n === null) return null;
  return Math.min(100, Math.max(0, n));
}

function asFiniteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function computePercentages(limit) {
  const remaining = asFiniteNumber(limit?.remaining);
  const currentValue = asFiniteNumber(limit?.currentValue);
  const usage = asFiniteNumber(limit?.usage);
  const totalFromParts = remaining !== null && currentValue !== null ? remaining + currentValue : null;
  const total = totalFromParts !== null && totalFromParts > 0 ? totalFromParts : usage;

  if (total !== null && total > 0) {
    if (remaining !== null && remaining >= 0 && remaining <= total) {
      const lp = clampPercent(Math.round((remaining / total) * 100));
      if (lp !== null) return { leftPercent: lp, usedPercent: 100 - lp };
    }
    if (currentValue !== null && currentValue >= 0 && currentValue <= total) {
      const up = clampPercent(Math.round((currentValue / total) * 100));
      if (up !== null) return { leftPercent: 100 - up, usedPercent: up };
    }
  }

  const usedPercent = clampPercent(limit?.percentage);
  if (usedPercent === null) return null;
  return { leftPercent: 100 - usedPercent, usedPercent };
}

function sortByResetTime(limits) {
  return [...limits].sort((a, b) => {
    const ar = asFiniteNumber(a?.nextResetTime);
    const br = asFiniteNumber(b?.nextResetTime);
    if (ar !== null && br !== null && ar !== br) return ar - br;
    if (ar !== null && br === null) return -1;
    if (ar === null && br !== null) return 1;
    return 0;
  });
}

function normalizeTokenQuota(key, limit) {
  const pct = computePercentages(limit);
  if (!pct) return null;
  return {
    key,
    leftPercent: pct.leftPercent,
    usedPercent: pct.usedPercent,
    nextResetTime: asFiniteNumber(limit?.nextResetTime),
  };
}

// ─── Provider Implementations ─────────────────────────────────────────────────

async function fetchMinimax(config, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && config.cache.data && now - config.cache.timestamp < config.cache.timeout) {
    return config.cache.data;
  }
  const response = await axios.get(config.endpoints.quota, {
    headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json" },
    timeout: 10000,
    httpsAgent: config.agent,
  });
  config.cache.data = response.data;
  config.cache.timestamp = now;
  return response.data;
}

function parseMinimaxResponse(data) {
  const modelRemains = Array.isArray(data.model_remains) ? data.model_remains : [];
  if (modelRemains.length === 0) throw new Error("No usage data");

  const m = modelRemains[0];
  const total = asFiniteNumber(m.current_interval_total_count);
  const used = asFiniteNumber(m.current_interval_usage_count);
  const safeUsed = used !== null && used >= 0 ? used : 0;
  const remaining = total !== null && total > 0 ? total - safeUsed : null;
  const usedPct = total > 0 ? Math.round((safeUsed / total) * 100) : 0;
  const leftPct = total > 0 ? Math.round((remaining / total) * 100) : 0;

  const remMs = asFiniteNumber(m.remains_time);
  const nextReset = remMs > 0 ? Date.now() + remMs : null;
  const hours = Math.floor(remMs / (1000 * 60 * 60));
  const minutes = Math.floor((remMs % (1000 * 60 * 60)) / (1000 * 60));

  const weeklyTotal = asFiniteNumber(m.current_weekly_total_count);
  const weeklyUsed = asFiniteNumber(m.current_weekly_usage_count);
  const weeklyPct = weeklyTotal > 0 ? Math.floor((weeklyUsed / weeklyTotal) * 100) : 0;
  const weeklyRemMs = asFiniteNumber(m.weekly_remains_time);
  const weeklyDays = Math.floor(weeklyRemMs / (1000 * 60 * 60 * 24));
  const weeklyHours = Math.floor((weeklyRemMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  return {
    modelName: m.model_name || "MiniMax",
    usage: { used: safeUsed, remaining, total, percentage: usedPct },
    leftPercent: leftPct,
    usedPercent: usedPct,
    remaining: { hours, minutes },
    weekly: { used: weeklyUsed, total: weeklyTotal, percentage: weeklyPct, days: weeklyDays, hours: weeklyHours },
    nextResetTime: nextReset,
  };
}

async function fetchGlm(config, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && config.cache.data && now - config.cache.timestamp < config.cache.timeout) {
    return config.cache.data;
  }
  const response = await axios.get(config.endpoints.quota, {
    headers: { Authorization: config.token, Accept: "application/json, text/plain, */*" },
    timeout: 10000,
    httpsAgent: config.agent,
  });
  config.cache.data = response.data;
  config.cache.timestamp = now;
  return response.data;
}

function parseGlmResponse(data) {
  if (!data || data.success !== true) throw new Error("API error");
  const limits = Array.isArray(data.data?.limits) ? data.data.limits : [];
  const tokenLimits = limits.filter(l => l?.type === "TOKENS_LIMIT").map((l, i) => ({ ...l, _index: i }));

  if (tokenLimits.length === 0) throw new Error("No token limits");

  const explicitFiveHour = tokenLimits.find(l => l?.number === 5);
  const sorted = sortByResetTime(tokenLimits);
  const [fiveHour, weekLimit] = explicitFiveHour
    ? [explicitFiveHour, sorted.find(l => l._index !== explicitFiveHour._index) || sorted.find(l => l._index === explicitFiveHour._index)]
    : [sorted[0], sorted[1]];

  const fiveHourQ = normalizeTokenQuota("token_5h", fiveHour);
  const weekQ = normalizeTokenQuota("token_week", weekLimit);

  const level = data.data?.level || "";
  const primary = fiveHourQ;
  if (!primary) throw new Error("No primary quota");

  return {
    modelName: level ? `GLM ${level.charAt(0).toUpperCase()}${level.slice(1)}` : "GLM",
    usage: { used: primary.usedPercent, remaining: primary.leftPercent, total: 100, percentage: primary.usedPercent },
    leftPercent: primary.leftPercent,
    usedPercent: primary.usedPercent,
    remaining: primary.nextResetTime ? {
      hours: Math.floor((primary.nextResetTime - Date.now()) / (1000 * 60 * 60)),
      minutes: Math.floor(((primary.nextResetTime - Date.now()) % (1000 * 60 * 60)) / (1000 * 60)),
    } : null,
    nextResetTime: primary.nextResetTime,
    weekly: weekQ ? { used: weekQ.usedPercent, total: 100, percentage: weekQ.usedPercent, days: 0, hours: 0 } : null,
    weeklyResetTime: weekQ?.nextResetTime,
  };
}

// ─── Agent Cache ───────────────────────────────────────────────────────────────

const agentCache = new Map();
function getHttpsAgent(servername) {
  if (agentCache.has(servername)) return agentCache.get(servername);
  const agent = new https.Agent({ keepAlive: true, maxSockets: 5, maxFreeSockets: 2, timeout: 10000, servername });
  agentCache.set(servername, agent);
  return agent;
}

// ─── Main API Class ───────────────────────────────────────────────────────────

class MinimaxAPI {
  constructor() {
    this.token = null;
    this.region = null;
    this.groupId = null;
    this.provider = null; // "minimax_cn" | "minimax_intl" | "glm_cn" | "glm_intl"
    this.configPath = path.join(process.env.HOME || process.env.USERPROFILE, ".minimax-config.json");
    this.cache = { data: null, timestamp: 0 };
    this.cacheTimeout = 8000;
    this.loadConfig();
  }

  getEndpoints() {
    return ENDPOINTS[this.provider] || ENDPOINTS.minimax_intl;
  }

  getHttpsAgent() {
    return getHttpsAgent(this.getEndpoints().servername);
  }

  loadConfig() {
    // 1. Detect from Claude Code settings.json
    const settingsPath = path.join(process.env.HOME || process.env.USERPROFILE, ".claude", "settings.json");
    if (fs.existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
        const baseUrl = settings?.env?.ANTHROPIC_BASE_URL || "";
        const token = settings?.env?.ANTHROPIC_AUTH_TOKEN || "";
        const model = settings?.env?.ANTHROPIC_MODEL || "";

        // GLM detection (GLM models or GLM base URLs)
        if (model.toLowerCase().includes("glm") || baseUrl.includes("bigmodel.cn") || baseUrl.includes("api.z.ai")) {
          this.provider = baseUrl.includes("api.z.ai") || !baseUrl ? "glm_intl" : "glm_cn";
          this.token = token;
          this.region = this.provider;
          return;
        }

        // MiniMax detection
        if (baseUrl.includes("minimaxi.com")) {
          this.provider = "minimax_cn";
          this.token = token;
          this.region = "minimax_cn";
          return;
        }
        if (baseUrl.includes("minimax.io") || token.startsWith("sk-cp-")) {
          this.provider = "minimax_intl";
          this.token = token;
          this.region = "minimax_intl";
          return;
        }
      } catch (e) { /* ignore */ }
    }

    // 2. Fallback: independent config file
    try {
      if (fs.existsSync(this.configPath)) {
        const config = JSON.parse(fs.readFileSync(this.configPath, "utf8"));
        if (config.token) {
          this.provider = config.region || "minimax_intl";
          this.token = config.token;
          this.region = config.region;
          return;
        }
      }
    } catch (e) { /* ignore */ }

    // 3. Default
    this.provider = "minimax_intl";
  }

  saveConfig() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify({ token: this.token, region: this.region }, null, 2));
    } catch (e) { /* ignore */ }
  }

  setCredentials(token, groupId, region = "minimax_intl") {
    this.token = token;
    this.groupId = groupId;
    this.region = region;
    this.provider = region;
    this.saveConfig();
  }

  async getUsageStatus(forceRefresh = false) {
    if (!this.token) throw new Error('Missing credentials');

    const cfg = {
      endpoints: this.getEndpoints(),
      agent: this.getHttpsAgent(),
      token: this.token,
      cache: this.cache,
      cacheTimeout: this.cacheTimeout,
    };

    if (this.provider.startsWith("minimax")) {
      const data = await fetchMinimax(cfg, forceRefresh);
      return parseMinimaxResponse(data);
    } else {
      const data = await fetchGlm(cfg, forceRefresh);
      return parseGlmResponse(data);
    }
  }
}

module.exports = MinimaxAPI;
