#!/usr/bin/env node

const chalk = require('chalk').default;

class Renderer {
  constructor() {
    this.RESET = '\x1b[0m';
    this.icons = {
      arrow: '>',
      leftArrow: '>',
      branch: '*'
    };
  }

  // severity based on used percent: green <60%, yellow 60-85%, red ≥85%
  getTone(usedPercent) {
    if (usedPercent >= 85) return 'danger';
    if (usedPercent >= 60) return 'warn';
    return 'good';
  }

  // ctx: green <60%, yellow 60-80%, red ≥80%
  getCtxTone(usedPercent) {
    if (usedPercent >= 80) return 'danger';
    if (usedPercent >= 60) return 'warn';
    return 'good';
  }

  colorBySeverity(percent, text) {
    const tone = this.getTone(percent);
    if (tone === 'danger') return chalk.red(text);
    if (tone === 'warn') return chalk.yellow(text);
    return chalk.green(text);
  }

  colorByCtx(percent, text) {
    const tone = this.getCtxTone(percent);
    if (tone === 'danger') return chalk.red(text);
    if (tone === 'warn') return chalk.yellow(text);
    return chalk.green(text);
  }

  buildBar(percent, width = 10) {
    const safe = Math.min(100, Math.max(0, percent));
    const filled = Math.round((safe / 100) * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
  }

  // statusline 输出格式（glm-quota-line 风格）
  render(context, options = {}) {
    const { modelName, usage, usagePercentage, remaining, weekly } = context;
    const showBar = options.showBar !== false;

    const parts = [];

    if (modelName) {
      parts.push(modelName);
    }

    // 5h 额度（已用）
    if (usage && usage.total > 0) {
      const bar = showBar ? this.buildBar(usagePercentage) : '';
      parts.push(`5h ${bar} ${this.colorBySeverity(usagePercentage, `${usagePercentage}%`)}`);
    }

    // 重置时间
    if (remaining) {
      const rt = remaining.hours > 0 ? `${remaining.hours}h${remaining.minutes}m` : `${remaining.minutes}m`;
      parts.push(`reset ${rt}`);
    }

    // Weekly 额度（已用）
    if (weekly && weekly.total > 0) {
      parts.push(`W ${this.colorBySeverity(weekly.percentage, `${weekly.percentage}%`)}`);
      if (weekly.days > 0 || weekly.hours > 0) {
        const wRt = weekly.days > 0 ? `${weekly.days}d${weekly.hours}h` : `${weekly.hours}h`;
        parts.push(`W:reset ${wRt}`);
      }
    }

    // Context window（已用）
    if (context.contextUsage && context.contextSize) {
      const pct = Math.round((context.contextUsage / context.contextSize) * 100);
      const bar = showBar ? this.buildBar(pct, 6) : '';
      parts.push(`ctx ${bar} ${this.colorByCtx(pct, `${pct}%`)}`);
    }

    return parts.join(' | ');
  }

  renderSessionLine(data, options = {}) {
    return this.render(data, options);
  }

  renderToolsLine(tools) { return null; }
  renderAgentsLine(agents) { return null; }
  renderTodosLine(todos) { return null; }
}

module.exports = Renderer;
