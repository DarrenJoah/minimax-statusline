const axios = require("axios");
const https = require("https");
const fs = require("fs");
const path = require("path");
const chalk = require("chalk").default;
const { getContextWindowSize, getDefaultContextWindowSize } = require('./model-context-sizes');

// ─── Endpoints ────────────────────────────────────────────────────────────────

const CN_API_BASE = "https://www.minimaxi.com";
const INTL_API_BASE = "https://www.minimax.io";

const ENDPOINTS = {
  cn: {
    quota: `${CN_API_BASE}/v1/token_plan/remains`,
    subscription: `${CN_API_BASE}/v1/api/openplatform/charge/combo/cycle_audio_resource_package`,
    billing: `${CN_API_BASE}/account/amount`,
    servername: "minimaxi.com",
  },
  intl: {
    quota: `${INTL_API_BASE}/v1/token_plan/remains`,
    subscription: `${INTL_API_BASE}/v1/api/openplatform/charge/combo/cycle_audio_resource_package`,
    billing: `${INTL_API_BASE}/account/amount`,
    servername: "minimax.io",
  },
};

// HTTPS agents for each region
const httpsAgentCn = new https.Agent({
  keepAlive: true,
  maxSockets: 5,
  maxFreeSockets: 2,
  timeout: 10000,
  servername: ENDPOINTS.cn.servername,
});

const httpsAgentIntl = new https.Agent({
  keepAlive: true,
  maxSockets: 5,
  maxFreeSockets: 2,
  timeout: 10000,
  servername: ENDPOINTS.intl.servername,
});

class MinimaxAPI {
  constructor() {
    this.token = null;
    this.region = null; // "cn" | "intl"
    this.groupId = null;
    this.configPath = path.join(
      process.env.HOME || process.env.USERPROFILE,
      ".minimax-config.json"
    );
    this.cache = {
      data: null,
      timestamp: 0,
    };
    this.cacheTimeout = 8000; // 8秒缓存
    this.loadConfig();
  }

  getEndpoints() {
    return this.region === "cn" ? ENDPOINTS.cn : ENDPOINTS.intl;
  }

  getHttpsAgent() {
    return this.region === "cn" ? httpsAgentCn : httpsAgentIntl;
  }

  loadConfig() {
    // 1. 优先从 Claude Code settings.json 检测 region 和 token
    const settingsPath = path.join(
      process.env.HOME || process.env.USERPROFILE,
      ".claude",
      "settings.json"
    );
    if (fs.existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
        const baseUrl = settings?.env?.ANTHROPIC_BASE_URL || "";
        const token = settings?.env?.ANTHROPIC_AUTH_TOKEN || "";

        if (baseUrl.includes("minimaxi.com") || token.includes("minimaxi")) {
          this.region = "cn";
          this.token = token || null;
        } else if (baseUrl.includes("minimax.io") || token.includes("minimax.io") || token.startsWith("sk-cp-")) {
          this.region = "intl";
          this.token = token;
        }
      } catch (e) {
        // ignore
      }
    }

    // 2. 降级：从独立配置文件读取
    if (!this.region || !this.token) {
      try {
        if (fs.existsSync(this.configPath)) {
          const config = JSON.parse(fs.readFileSync(this.configPath, "utf8"));
          if (config.token) {
            // 配置文件默认 CN（兼容旧版）
            this.region = config.region || "cn";
            this.token = config.token;
            this.groupId = config.groupId;
          }
        }
      } catch (error) {
        // ignore
      }
    }

    // 3. 默认 INTL
    if (!this.region) {
      this.region = "intl";
    }
  }

  saveConfig() {
    try {
      const config = {
        token: this.token,
        region: this.region,
        groupId: this.groupId,
      };
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      console.error("Failed to save config:", error.message);
    }
  }

  setCredentials(token, groupId, region = "intl") {
    this.token = token;
    this.groupId = groupId;
    this.region = region;
    this.saveConfig();
  }

  async getUsageStatus(forceRefresh = false) {
    if (!this.token) {
      throw new Error(
        'Missing credentials. Please run "minimax auth <token>" first'
      );
    }

    // 检查缓存
    const now = Date.now();
    if (
      !forceRefresh &&
      this.cache.data &&
      now - this.cache.timestamp < this.cacheTimeout
    ) {
      return this.cache.data;
    }

    const ep = this.getEndpoints();
    const agent = this.getHttpsAgent();

    try {
      const response = await axios.get(ep.quota, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
        },
        timeout: 10000,
        httpsAgent: agent,
      });

      this.cache.data = response.data;
      this.cache.timestamp = now;
      return response.data;
    } catch (error) {
      if (error.response?.status === 401) {
        throw new Error(
          "Invalid token or unauthorized. Please check your credentials."
        );
      } else if (error.code === "ECONNABORTED") {
        throw new Error("Request timeout. Please check your network connection.");
      } else if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
        throw new Error("Network error. Please check your internet connection.");
      }
      throw new Error(`API request failed: ${error.message}`);
    }
  }

  async getSubscriptionDetails() {
    if (!this.token) return null;

    const ep = this.getEndpoints();
    const agent = this.getHttpsAgent();

    try {
      const response = await axios.get(ep.subscription, {
        params: {
          biz_line: 2,
          cycle_type: 1,
          resource_package_type: 7,
        },
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
        },
        timeout: 10000,
        httpsAgent: agent,
      });

      return response.data;
    } catch (error) {
      return null;
    }
  }

  async getBillingRecords(page = 1, limit = 100) {
    if (!this.token) {
      throw new Error("No credentials");
    }

    const ep = this.getEndpoints();
    const agent = this.getHttpsAgent();

    try {
      const response = await axios.get(ep.billing, {
        params: { page, limit, aggregate: false },
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
        },
        timeout: 10000,
        httpsAgent: agent,
      });

      return response.data;
    } catch (error) {
      throw new Error(`Billing API request failed: ${error.message}`);
    }
  }

  async getAllBillingRecords(maxPages = 100, minStartTime = 0) {
    const allRecords = [];

    for (let page = 1; page <= maxPages; page++) {
      try {
        const response = await this.getBillingRecords(page, 100);
        const records = response.charge_records || [];

        if (records.length === 0) break;
        allRecords.push(...records);

        if (minStartTime > 0) {
          const lastRecord = records[records.length - 1];
          const lastRecordTime = (lastRecord.created_at || 0) * 1000;
          if (lastRecordTime < minStartTime) break;
        }

        if (records.length < 100) break;
      } catch (error) {
        break;
      }
    }

    return allRecords;
  }

  calculateUsageStats(records, planStartTime, planEndTime) {
    const now = Date.now();
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const stats = { lastDayUsage: 0, weeklyUsage: 0, planTotalUsage: 0 };

    for (const record of records) {
      const tokens = parseInt(record.consume_token, 10) || 0;
      const createdAt = (record.created_at || 0) * 1000;

      if (createdAt >= yesterdayStart && createdAt < todayStart) {
        stats.lastDayUsage += tokens;
      }
      if (createdAt >= weekAgo) {
        stats.weeklyUsage += tokens;
      }
      if (createdAt >= planStartTime && createdAt <= planEndTime) {
        stats.planTotalUsage += tokens;
      }
    }

    return stats;
  }

  formatNumber(num) {
    if (num >= 100000000) {
      return (num / 100000000).toFixed(1).replace(/\.0$/, "") + "亿";
    }
    if (num >= 10000) {
      return (num / 10000).toFixed(1).replace(/\.0$/, "") + "万";
    }
    return num.toLocaleString("zh-CN");
  }

  clearCache() {
    this.cache = { data: null, timestamp: 0 };
  }

  parseUsageData(apiData, subscriptionData) {
    if (!apiData.model_remains || apiData.model_remains.length === 0) {
      throw new Error("No usage data available");
    }

    const modelData = apiData.model_remains[0];
    const startTime = new Date(modelData.start_time);
    const endTime = new Date(modelData.end_time);

    const usedCount = modelData.current_interval_usage_count;
    const remainingCount = modelData.current_interval_total_count - usedCount;
    const usedPercentage = Math.round(
      (usedCount / modelData.current_interval_total_count) * 100
    );

    const remainingMs = modelData.remains_time;
    const hours = Math.floor(remainingMs / (1000 * 60 * 60));
    const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

    const weeklyUsed = modelData.current_weekly_usage_count;
    const weeklyTotal = modelData.current_weekly_total_count;
    const weeklyPercentage = weeklyTotal > 0 ? Math.floor((weeklyUsed / weeklyTotal) * 100) : 0;
    const weeklyRemainingMs = modelData.weekly_remains_time;
    const weeklyDays = Math.floor(weeklyRemainingMs / (1000 * 60 * 60 * 24));
    const weeklyHours = Math.floor((weeklyRemainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    let expiryInfo = null;
    if (
      subscriptionData &&
      subscriptionData.current_subscribe &&
      subscriptionData.current_subscribe.current_subscribe_end_time
    ) {
      const expiryDate = subscriptionData.current_subscribe.current_subscribe_end_time;
      const expiry = new Date(expiryDate);
      const now = new Date();
      const timeDiff = expiry.getTime() - now.getTime();
      const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));

      expiryInfo = {
        date: expiryDate,
        daysRemaining: daysDiff,
        text:
          daysDiff > 0
            ? `还剩 ${daysDiff} 天`
            : daysDiff === 0
            ? "今天到期"
            : `已过期 ${Math.abs(daysDiff)} 天`,
      };
    }

    const contextWindowSize =
      getContextWindowSize(modelData.model_name) || getDefaultContextWindowSize();
    const contextWindow = {
      total: contextWindowSize,
      used: 0,
      percentage: 0,
      totalFormatted: "200K",
      usedFormatted: "0K",
    };

    return {
      modelName: modelData.model_name,
      timeWindow: {
        start: startTime.toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Shanghai",
          hour12: false,
        }),
        end: endTime.toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Shanghai",
          hour12: false,
        }),
        timezone: "UTC+8",
      },
      remaining: {
        hours,
        minutes,
        text:
          hours > 0
            ? `${hours} 小时 ${minutes} 分钟后重置`
            : `${minutes} 分钟后重置`,
      },
      usage: {
        used: usedCount,
        remaining: remainingCount,
        total: modelData.current_interval_total_count,
        percentage: usedPercentage,
      },
      weekly: {
        used: weeklyUsed,
        total: weeklyTotal,
        percentage: weeklyPercentage,
        days: weeklyDays,
        hours: weeklyHours,
        unlimited: weeklyTotal === 0,
        text: weeklyDays > 0
          ? `${weeklyDays} 天 ${weeklyHours} 小时后重置`
          : `${weeklyHours} 小时后重置`,
      },
      contextWindow,
      expiry: expiryInfo,
    };
  }

  parseAllModels(apiData) {
    if (!apiData.model_remains || apiData.model_remains.length === 0) {
      return [];
    }

    return apiData.model_remains.map((modelData) => {
      const totalCount = modelData.current_interval_total_count;
      const usedCount = modelData.current_interval_usage_count;
      const remainingCount = totalCount - usedCount;
      const usedPercentage = totalCount > 0 ? Math.round((usedCount / totalCount) * 100) : 0;

      const weeklyTotal = modelData.current_weekly_total_count || 0;
      const weeklyUsed = modelData.current_weekly_usage_count || 0;
      const weeklyRemainingCount = weeklyTotal - weeklyUsed;
      const weeklyPercentage = weeklyTotal > 0 ? Math.floor((weeklyUsed / weeklyTotal) * 100) : 0;

      return {
        name: modelData.model_name,
        used: usedCount,
        remaining: remainingCount,
        total: totalCount,
        percentage: usedPercentage,
        unlimited: weeklyTotal === 0,
        weeklyPercentage,
        weeklyTotal,
        weeklyRemainingCount,
      };
    });
  }
}

module.exports = MinimaxAPI;
