#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

class TranscriptParser {
  constructor() {
    this.toolMap = new Map();
    this.agentMap = new Map();
    this.latestTodos = [];
  }

  async parse(transcriptPath) {
    const result = {
      tools: [],
      agents: [],
      todos: [],
      sessionStart: null,
      contextTokens: 0,
    };

    if (typeof transcriptPath !== 'string' || !fs.existsSync(transcriptPath)) {
      return result;
    }

    try {
      const fileStream = fs.createReadStream(transcriptPath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) continue;

        try {
          const entry = JSON.parse(line);
          this.processEntry(entry, result);
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // Return partial results on error
    }

    result.tools = Array.from(this.toolMap.values()).slice(-20);
    result.agents = Array.from(this.agentMap.values()).slice(-10);
    result.todos = this.latestTodos;

    return result;
  }

  processEntry(entry, result) {
    const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();

    if (!result.sessionStart && entry.timestamp) {
      result.sessionStart = timestamp;
    }

    const content = entry.message?.content;
    if (!content || !Array.isArray(content)) return;

    for (const block of content) {
      if (block.type === 'tool_use' && block.id && block.name) {
        const toolEntry = {
          id: block.id,
          name: block.name,
          target: this.extractTarget(block.name, block.input),
          status: 'running',
          startTime: timestamp,
        };

        if (block.name === 'Task') {
          const input = block.input || {};
          const agentEntry = {
            id: block.id,
            type: input.subagent_type || 'unknown',
            model: input.model,
            description: input.description,
            status: 'running',
            startTime: timestamp,
          };
          this.agentMap.set(block.id, agentEntry);
        } else if (block.name === 'TodoWrite') {
          const input = block.input || {};
          if (input.todos && Array.isArray(input.todos)) {
            this.latestTodos.length = 0;
            this.latestTodos.push(...input.todos);
          }
        } else {
          this.toolMap.set(block.id, toolEntry);
        }
      }

      if (block.type === 'tool_result' && block.tool_use_id) {
        const tool = this.toolMap.get(block.tool_use_id);
        if (tool) {
          tool.status = block.is_error ? 'error' : 'completed';
          tool.endTime = timestamp;
        }

        const agent = this.agentMap.get(block.tool_use_id);
        if (agent) {
          agent.status = 'completed';
          agent.endTime = timestamp;
        }
      }
    }
  }

  extractTarget(toolName, input) {
    if (!input) return undefined;

    switch (toolName) {
      case 'Read':
      case 'Write':
      case 'Edit':
        return input.file_path || input.path;
      case 'Glob':
        return input.pattern;
      case 'Grep':
        return input.pattern;
      case 'Bash':
        const cmd = input.command;
        if (typeof cmd === 'string') {
          return cmd.slice(0, 30) + (cmd.length > 30 ? '...' : '');
        }
        return undefined;
    }
    return undefined;
  }

  calculateContextTokens(usage) {
    const inputTokens = usage?.input_tokens || usage?.prompt_tokens || 0;
    const outputTokens = usage?.output_tokens || usage?.completion_tokens || 0;
    const cacheCreation = usage?.cache_creation_input_tokens || usage?.cache_creation_prompt_tokens || 0;
    const cacheRead = usage?.cache_read_input_tokens || usage?.cache_read_prompt_tokens || usage?.cached_tokens || 0;

    return inputTokens + outputTokens + cacheCreation + cacheRead;
  }

  async findLatestUsage(transcriptPath) {
    if (typeof transcriptPath !== 'string' || !fs.existsSync(transcriptPath)) {
      return null;
    }

    try {
      const stats = fs.statSync(transcriptPath);
      const fileSize = stats.size;
      const bufferSize = Math.min(fileSize, 64 * 1024); // 读取最后 64KB
      const buffer = Buffer.alloc(bufferSize);
      
      const fd = fs.openSync(transcriptPath, 'r');
      fs.readSync(fd, buffer, 0, bufferSize, Math.max(0, fileSize - bufferSize));
      fs.closeSync(fd);

      const content = buffer.toString('utf8');
      const lines = content.split('\n').filter(line => line.trim());

      if (lines.length === 0) return null;

      // 检查最后一行是否是 summary
      const lastLine = lines[lines.length - 1].trim();
      try {
        const lastEntry = JSON.parse(lastLine);
        if (lastEntry.type === 'summary' && lastEntry.leafUuid) {
          return this.findUsageByUuid(transcriptPath, lastEntry.leafUuid);
        }
      } catch (e) {}

      // 从后往前找最近的 assistant usage
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.type === 'assistant' && entry.message?.usage) {
            return this.calculateContextTokens(entry.message.usage);
          }
        } catch (e) {
          continue;
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  async findUsageByUuid(filePath, targetUuid) {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const lines = fileContent.trim().split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const entry = JSON.parse(line.trim());
          if (entry.uuid === targetUuid && entry.message?.usage) {
            return this.calculateContextTokens(entry.message.usage);
          }
        } catch {
          continue;
        }
      }

      return null;
    } catch {
      return null;
    }
  }
}

module.exports = TranscriptParser;
