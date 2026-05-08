#!/usr/bin/env node

// 示例数据，展示工具的功能
const StatusBar = require('./status');
const chalk = require('chalk');

// 模拟 API 数据
const mockApiData = {
  model_remains: [{
    start_time: 1763863200000,      // 10:00 UTC+8
    end_time: 1763881200000,        // 15:00 UTC+8
    remains_time: 5160754,          // 剩余时间（毫秒）
    current_interval_total_count: 4500,      // 总次数
    current_interval_usage_count: 3307,      // 已使用次数
    model_name: "MiniMax-M2"
  }],
  base_resp: {
    status_code: 0,
    status_msg: "success"
  }
};

// 模拟 API 类
class MockAPI {
  parseUsageData(apiData) {
    const modelData = apiData.model_remains[0];
    const startTime = new Date(modelData.start_time);
    const endTime = new Date(modelData.end_time);

    const remainingMs = modelData.remains_time;
    const hours = Math.floor(remainingMs / (1000 * 60 * 60));
    const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

    // Calculate counts
    // 注意：current_interval_usage_count 实际是剩余次数，不是已用次数
    const remainingCount = modelData.current_interval_usage_count;
    const usedCount = modelData.current_interval_total_count - remainingCount;

    // Calculate percentage - 基于已使用次数的百分比
    const usedPercentage = Math.round((usedCount / modelData.current_interval_total_count) * 100);

    return {
      modelName: modelData.model_name,
      timeWindow: {
        start: startTime.toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Shanghai',
          hour12: false
        }),
        end: endTime.toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Shanghai',
          hour12: false
        }),
        timezone: 'UTC+8'
      },
      remaining: {
        hours,
        minutes,
        text: hours > 0 ? `${hours} 小时 ${minutes} 分钟后重置` : `${minutes} 分钟后重置`
      },
      usage: {
        used: remainingCount,
        total: modelData.current_interval_total_count,
        percentage: usedPercentage
      }
    };
  }
}

// 运行示例
const api = new MockAPI();
const usageData = api.parseUsageData(mockApiData);
const statusBar = new StatusBar(usageData);

console.log('=== MiniMax Claude Code 状态栏示例 ===\n');
console.log(statusBar.render());
console.log('\n=== 紧凑模式示例 ===\n');
console.log(statusBar.renderCompact());
console.log('\n');
