#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

class ConfigCounter {
  constructor() {
    this.homeDir = os.homedir();
    this.claudeDir = path.join(this.homeDir, '.claude');
  }

  countMcpServers(filePath) {
    if (typeof filePath !== 'string' || !fs.existsSync(filePath)) return new Set();

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const config = JSON.parse(content);
      if (config.mcpServers && typeof config.mcpServers === 'object') {
        return new Set(Object.keys(config.mcpServers));
      }
    } catch {
      // Ignore errors
    }
    return new Set();
  }

  countMcpServersInFile(filePath, excludeFrom) {
    const servers = this.countMcpServers(filePath);
    if (excludeFrom) {
      const exclude = this.countMcpServers(excludeFrom);
      for (const name of exclude) {
        servers.delete(name);
      }
    }
    return servers.size;
  }

  countHooks(filePath) {
    if (typeof filePath !== 'string' || !fs.existsSync(filePath)) return 0;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const config = JSON.parse(content);
      if (config.hooks && typeof config.hooks === 'object') {
        return Object.keys(config.hooks).length;
      }
    } catch {
      // Ignore errors
    }
    return 0;
  }

  countRulesInDir(rulesDir) {
    if (typeof rulesDir !== 'string' || !fs.existsSync(rulesDir)) return 0;

    let count = 0;
    try {
      const entries = fs.readdirSync(rulesDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(rulesDir, entry.name);
        if (entry.isDirectory()) {
          count += this.countRulesInDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          count++;
        }
      }
    } catch {
      // Ignore errors
    }
    return count;
  }

  async count(cwd) {
    let claudeMdCount = 0;
    let rulesCount = 0;
    let mcpCount = 0;
    let hooksCount = 0;

    // User scope
    if (fs.existsSync(path.join(this.claudeDir, 'CLAUDE.md'))) {
      claudeMdCount++;
    }

    rulesCount += this.countRulesInDir(path.join(this.claudeDir, 'rules'));

    const userSettings = path.join(this.claudeDir, 'settings.json');
    mcpCount += this.countMcpServersInFile(userSettings);
    hooksCount += this.countHooks(userSettings);

    const userClaudeJson = path.join(this.homeDir, '.claude.json');
    mcpCount += this.countMcpServersInFile(userClaudeJson, userSettings);

    // Project scope
    if (cwd) {
      if (fs.existsSync(path.join(cwd, 'CLAUDE.md'))) {
        claudeMdCount++;
      }

      if (fs.existsSync(path.join(cwd, 'CLAUDE.local.md'))) {
        claudeMdCount++;
      }

      if (fs.existsSync(path.join(cwd, '.claude', 'CLAUDE.md'))) {
        claudeMdCount++;
      }

      if (fs.existsSync(path.join(cwd, '.claude', 'CLAUDE.local.md'))) {
        claudeMdCount++;
      }

      rulesCount += this.countRulesInDir(path.join(cwd, '.claude', 'rules'));

      mcpCount += this.countMcpServersInFile(path.join(cwd, '.mcp.json'));

      const projectSettings = path.join(cwd, '.claude', 'settings.json');
      mcpCount += this.countMcpServersInFile(projectSettings);
      hooksCount += this.countHooks(projectSettings);

      const localSettings = path.join(cwd, '.claude', 'settings.local.json');
      mcpCount += this.countMcpServersInFile(localSettings);
      hooksCount += this.countHooks(localSettings);
    }

    return {
      claudeMdCount,
      rulesCount,
      mcpCount,
      hooksCount,
    };
  }
}

module.exports = ConfigCounter;
