const MinimaxAPI = require("./api");
const chalk = require("chalk").default;
const fs = require("fs");
const path = require("path");

class PromptStatus {
  constructor() {
    this.api = new MinimaxAPI();
  }

  async loadSettings() {
    // 尝试从各种位置加载 settings.json
    const possiblePaths = [
      path.join(
        process.env.HOME || process.env.USERPROFILE,
        ".claude",
        "settings.json"
      ),
      path.join(
        process.env.HOME || process.env.USERPROFILE,
        ".config",
        "claude",
        "settings.json"
      ),
      path.join(process.cwd(), ".claude-settings.json"),
      path.join(process.cwd(), ".claude", "settings.json"),
    ];

    for (const configPath of possiblePaths) {
      if (fs.existsSync(configPath)) {
        try {
          const settings = JSON.parse(fs.readFileSync(configPath, "utf8"));
          if (settings.minimaxToken && settings.minimaxGroupId) {
            this.api.setCredentials(
              settings.minimaxToken,
              settings.minimaxGroupId
            );
            return settings.minimaxStatus || {};
          }
        } catch (error) {
          console.error(
            `Failed to read settings from ${configPath}:`,
            error.message
          );
        }
      }
    }

    return {};
  }

  async getPromptStatus(mode = "compact") {
    try {
      await this.loadSettings();
      const [apiData, subscriptionData] = await Promise.all([
        this.api.getUsageStatus(),
        this.api.getSubscriptionDetails(),
      ]);
      const usageData = this.api.parseUsageData(apiData, subscriptionData);

      if (mode === "compact") {
        return this.renderCompact(usageData);
      } else if (mode === "minimal") {
        return this.renderMinimal(usageData);
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  renderMinimal(data) {
    const { usage } = data;
    const percentage = usage.percentage;

    let color = chalk.green;
    if (percentage >= 85) {
      color = chalk.red;
    } else if (percentage >= 60) {
      color = chalk.yellow;
    }

    return color(`[MM:${percentage}%]`);
  }

  renderCompact(data) {
    const { usage, remaining, modelName, expiry } = data;
    const percentage = usage.percentage;

    let color = chalk.green;
    if (percentage >= 85) {
      color = chalk.red;
    } else if (percentage >= 60) {
      color = chalk.yellow;
    }

    const status = percentage >= 85 ? "⚠" : percentage >= 60 ? "⚡" : "✓";
    const remainingText =
      remaining.hours > 0
        ? `${remaining.hours}h${remaining.minutes}m`
        : `${remaining.minutes}m`;

    // 添加到期信息（如果可用）
    const expiryInfo = expiry ? ` ${chalk.cyan('•')} 剩余: ${expiry.daysRemaining}天` : '';

    return `${color("●")} ${modelName} ${color(
      percentage + "%"
    )} ${remainingText} ${status}${expiryInfo}`;
  }
}

// CLI 使用
async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes("--minimal") ? "minimal" : "compact";

  const prompt = new PromptStatus();
  const output = await prompt.getPromptStatus(mode);

  if (output) {
    console.log(output);
  } else {
    // 静默模式 - 未配置时不输出
  }
}

if (require.main === module) {
  main().catch((error) => {
    // 静默失败，用于提示集成
    process.exit(0);
  });
}

module.exports = PromptStatus;
