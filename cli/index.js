#!/usr/bin/env node

// Force color output even in non-TTY environments (e.g., Claude Code statusline)
process.env.FORCE_COLOR = "1";

const { Command } = require("commander");
const chalk = require("chalk").default;
const ora = require("ora").default;
const MinimaxAPI = require("./api");
const Renderer = require("./renderer");
const packageJson = require("../package.json");
const { getContextWindowSize, getDefaultContextWindowSize } = require('./model-context-sizes');

const program = new Command();
const api = new MinimaxAPI();
const renderer = new Renderer();

program
  .name("minimax-status")
  .description("MiniMax Claude Code 使用状态监控工具")
  .version(packageJson.version);

// Auth command (设置认证凭据)
program
  .command("auth")
  .description("设置认证凭据")
  .argument("<token>", "MiniMax 访问令牌")
  .argument("[groupId]", "MiniMax 组 ID（已废弃，可不填）")
  .option("-r, --region <cn|intl>", "区域：cn(国内) 或 intl(国际)", "intl")
  .action((token, groupId, options) => {
    const region = options.region === "cn" ? "cn" : "intl";
    api.setCredentials(token, groupId || null, region);
    const label = region === "cn" ? "MiniMax CN" : "MiniMax INTL";
    console.log(chalk.green(`✓ ${label} 认证信息已保存`));
  });

// Health check command (检查配置和连接状态)
program
  .command("health")
  .description("检查配置和连接状态")
  .action(async () => {
    const spinner = ora("正在检查...").start();
    let checks = {
      config: false,
      token: false,
      region: false,
      api: false,
    };

    // 检查配置文件（存在即通过，Claude Code settings 过来的不算配置文件）
    try {
      const configPath = require("path").join(
        process.env.HOME || process.env.USERPROFILE,
        ".minimax-config.json"
      );
      if (require("fs").existsSync(configPath)) {
        checks.config = true;
        spinner.succeed("配置文件检查");
      } else {
        // 从 Claude Code settings 读取 token 时，配置文件不存在不算问题
        if (api.token && api.region) {
          spinner.succeed("认证检查");
          checks.config = true;
        } else {
          spinner.fail("配置文件检查失败");
        }
      }
    } catch (error) {
      spinner.fail("配置文件检查失败");
    }

    const labelMap = {
      minimax_cn: "MiniMax CN (minimaxi.com)",
      minimax_intl: "MiniMax INTL (minimax.io)",
      glm_cn: "GLM CN (bigmodel.cn)",
      glm_intl: "GLM INTL (api.z.ai)",
    };

    // 检查Token
    if (api.token) {
      checks.token = true;
      const label = labelMap[api.region] || api.region;
      console.log(chalk.green("✓ Token: ") + chalk.gray(`已配置 (${label})`));
    } else {
      console.log(chalk.red("✗ Token: ") + chalk.gray("未配置"));
    }

    // 检查Region
    if (api.region) {
      checks.region = true;
      console.log(chalk.green("✓ Region: ") + chalk.gray(labelMap[api.region] || api.region));
    } else {
      console.log(chalk.red("✗ Region: ") + chalk.gray("未检测到"));
    }

    // 测试API连接
    if (checks.token && checks.region) {
      try {
        await api.getUsageStatus();
        checks.api = true;
        console.log(chalk.green("✓ API连接: ") + chalk.gray("正常"));
      } catch (error) {
        console.log(chalk.red("✗ API连接: ") + chalk.gray(error.message));
      }
    }

    // 总结
    console.log("\n" + chalk.bold("健康检查结果:"));
    const allPassed = Object.values(checks).every((v) => v);
    if (allPassed) {
      console.log(chalk.green("✓ 所有检查通过，配置正常！"));
    } else {
      console.log(chalk.yellow("⚠ 发现问题，请检查上述错误信息"));
    }
  });

// Status command (显示当前使用状态)
program
  .command("status")
  .description("显示当前使用状态")
  .option("-c, --compact", "紧凑模式显示")
  .option("-w, --watch", "实时监控模式")
  .action(async (options) => {
    const spinner = ora("获取使用状态中...").start();

    try {
      const usageData = await api.getUsageStatus();

      spinner.succeed("状态获取成功");

      const renderer = new Renderer();
      const parts = [];

      if (usageData.modelName) {
        parts.push(usageData.modelName);
      }
      if (usageData.usage && usageData.usage.total > 0) {
        parts.push(`5h used ${usageData.usage.percentage}%`);
      }
      if (usageData.remaining) {
        const rt = usageData.remaining.hours > 0
          ? `${usageData.remaining.hours}h${usageData.remaining.minutes}m`
          : `${usageData.remaining.minutes}m`;
        parts.push(`reset ${rt}`);
      }
      if (usageData.weekly && usageData.weekly.total > 0) {
        parts.push(`W used ${usageData.weekly.percentage}%`);
        if (usageData.weekly.days > 0 || usageData.weekly.hours > 0) {
          const wrt = usageData.weekly.days > 0
            ? `${usageData.weekly.days}d${usageData.weekly.hours}h`
            : `${usageData.weekly.hours}h`;
          parts.push(`W:reset ${wrt}`);
        }
      }

      console.log(parts.join(' | '));
    } catch (error) {
      spinner.fail(chalk.red("获取状态失败"));
      console.error(chalk.red(`错误: ${error.message}`));
      process.exit(1);
    }
  });

// List command (显示所有模型的使用状态)
program
  .command("list")
  .description("显示所有模型的使用状态")
  .action(async () => {
    const spinner = ora("获取使用状态中...").start();
    try {
      const usageData = await api.getUsageStatus();
      spinner.succeed("状态获取成功");
      console.log(JSON.stringify(usageData, null, 2));
    } catch (error) {
      spinner.fail(chalk.red("获取状态失败"));
      console.error(chalk.red(`错误: ${error.message}`));
      process.exit(1);
    }
  });

// StatusBar command (持续显示在终端底部)
program
  .command("bar")
  .description("在终端底部持续显示状态栏")
  .action(async () => {
    const TerminalStatusBar = require("./statusbar");
    const statusBar = new TerminalStatusBar();
    await statusBar.start();
  });

// Statusline command - 单次输出模式（Claude Code自己控制刷新）
program
  .command("statusline")
  .description("Claude Code状态栏集成（从stdin读取数据，单次输出）")
  .option("--no-bar", "不显示进度条，只显示数字")
  .action(async (options) => {
    const showBar = options.bar !== false;
    let stdinData = null;
    if (!process.stdin.isTTY) {
      // 使用 Promise.race 添加超时，避免 Claude Code 场景下挂起
      const readStdin = async () => {
        const chunks = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        return Buffer.concat(chunks).toString();
      };

      try {
        const stdinString = await Promise.race([
          readStdin(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('stdin timeout')), 1000))
        ]);

        if (stdinString.trim()) {
          try {
            stdinData = JSON.parse(stdinString);
          } catch (e) {
            // 静默忽略解析错误
          }
        }
      } catch (e) {
        // 超时或其他错误，静默继续
      }
    }

    const cliCurrentDir = process.cwd().split(/[/\\]/).pop();

    let displayModel = "Unknown";
    let currentDir = null;

    if (stdinData) {
      if (stdinData.model && stdinData.model.display_name) {
        displayModel = stdinData.model.display_name;
      } else if (stdinData.model && stdinData.model.id) {
        displayModel = stdinData.model.id;
      }
      if (stdinData.workspace && stdinData.workspace.current_directory) {
        currentDir = stdinData.workspace.current_directory.split("/").pop();
      }
    }

    // Update API config based on detected model
    api.updateConfigByModel(displayModel);

    try {
      const usageData = await api.getUsageStatus();

      const displayDir = currentDir || cliCurrentDir || "";

      // Context window
      let contextUsageValue = 0;
      let contextSizeValue = getContextWindowSize(displayModel) || getDefaultContextWindowSize();
      if (stdinData?.context_window) {
        const cw = stdinData.context_window;
        contextSizeValue = cw.context_window_size || contextSizeValue;
        contextUsageValue = cw.tokens_used || 0;
      }

      const context = {
        modelName: displayModel,
        currentDir: displayDir,
        usage: usageData.usage,
        usagePercentage: usageData.usage?.percentage || 0,
        remaining: usageData.remaining,
        weekly: usageData.weekly,
        nextResetTime: usageData.nextResetTime,
        contextUsage: contextUsageValue,
        contextSize: contextSizeValue,
      };

      console.log(renderer.render(context, { showBar }));
    } catch (error) {
      console.log(`❌ MiniMax 错误: ${error.message}`);
    }
  });

// Droid-statusline command - Droid 状态栏集成（从 session 文件读取数据）
program
  .command("droid-statusline")
  .description("Droid状态栏集成（从 session 文件读取数据，单次输出）")
  .argument("[sessionPath]", "Droid session 目录路径（可选，默认自动查找）")
  .action(async (sessionPath) => {
    const fs = require("fs");
    const path = require("path");

    // 查找 session 目录
    let targetSessionPath = sessionPath;
    const currentCwd = process.cwd().replace(/\\/g, "/");
    
    if (!targetSessionPath) {
      const sessionsDir = path.join(process.env.HOME || process.env.USERPROFILE, ".factory", "sessions");
      
      if (!fs.existsSync(sessionsDir)) {
        console.log("❌ 未找到 Droid sessions 目录");
        process.exit(1);
      }

      // 优先查找与当前工作目录匹配的 session
      const userDirs = fs.readdirSync(sessionsDir);
      let matchedSession = null;
      let latestSession = null;
      let latestStartTime = 0;

      for (const userDir of userDirs) {
        const userPath = path.join(sessionsDir, userDir);
        if (!fs.statSync(userPath).isDirectory()) continue;

        const sessions = fs.readdirSync(userPath);
        for (const session of sessions) {
          if (!session.endsWith(".jsonl")) continue;
          
          const jsonlPath = path.join(userPath, session);
          try {
            const content = fs.readFileSync(jsonlPath, "utf8");
            const firstLine = content.split("\n")[0];
            const entry = JSON.parse(firstLine);
            
            if (entry.cwd) {
              const sessionCwd = entry.cwd.replace(/\\/g, "/");
              // 优先匹配当前工作目录
              if (sessionCwd === currentCwd || currentCwd.includes(sessionCwd) || sessionCwd.includes(currentCwd)) {
                if (!matchedSession) {
                  matchedSession = userPath;
                }
              }
            }
            
            // 记录最新 session
            if (entry.timestamp) {
              const startTime = new Date(entry.timestamp).getTime();
              if (startTime > latestStartTime) {
                latestStartTime = startTime;
                latestSession = userPath;
              }
            }
          } catch (e) {
            // continue
          }
        }
      }

      // 优先使用匹配的 session，否则用最新的
      targetSessionPath = matchedSession || latestSession;

      if (!targetSessionPath) {
        console.log("❌ 未找到 Droid session");
        process.exit(1);
      }
    }

    // 读取 settings.json
    const settingsFiles = fs.readdirSync(targetSessionPath).filter(f => f.endsWith(".settings.json"));
    let settings = {};
    
    for (const sf of settingsFiles) {
      try {
        const content = fs.readFileSync(path.join(targetSessionPath, sf), "utf8");
        const parsed = JSON.parse(content);
        if (parsed.tokenUsage) {
          settings = parsed;
          break;
        }
      } catch (e) {
        // continue
      }
    }

    // 读取 jsonl 获取 cwd 和模型信息，以及实时 token 使用量
    let cwd = process.cwd();
    let jsonlTokens = null;
    const jsonlFiles = fs.readdirSync(targetSessionPath).filter(f => f.endsWith(".jsonl"));
    
    for (const jf of jsonlFiles) {
      try {
        const content = fs.readFileSync(path.join(targetSessionPath, jf), "utf8");
        const lines = content.split('\n').filter(l => l.trim());
        
        // 获取第一行获取 cwd
        if (lines.length > 0) {
          try {
            const firstEntry = JSON.parse(lines[0]);
            if (firstEntry.cwd) {
              cwd = firstEntry.cwd;
            }
          } catch (e) {}
        }
        
        // 从最后的消息中解析实时 token 使用量
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const entry = JSON.parse(lines[i]);
            // 查找 assistant 消息中的 usage
            if (entry.type === 'message' && entry.message?.role === 'assistant' && entry.message?.usage) {
              const u = entry.message.usage;
              jsonlTokens = {
                inputTokens: u.input_tokens || u.prompt_tokens || 0,
                outputTokens: u.output_tokens || u.completion_tokens || 0,
                cacheCreationTokens: u.cache_creation_input_tokens || u.cache_creation_prompt_tokens || 0,
                cacheReadTokens: u.cache_read_input_tokens || u.cache_read_prompt_tokens || 0,
                thinkingTokens: u.thinking_tokens || 0
              };
              break;
            }
          } catch (e) {
            continue;
          }
        }
      } catch (e) {
        // continue
      }
    }

    const currentDir = cwd.split(/[/\\]/).pop();

    // 优先使用 jsonl 中的实时 token 使用量，否则用 settings 中的累计值
    const tokenUsage = (jsonlTokens && (jsonlTokens.inputTokens > 0 || jsonlTokens.outputTokens > 0)) 
      ? jsonlTokens 
      : (settings.tokenUsage || {});
    
    const inputTokens = tokenUsage.inputTokens || 0;
    const outputTokens = tokenUsage.outputTokens || 0;
    const cacheCreationTokens = tokenUsage.cacheCreationTokens || 0;
    const cacheReadTokens = tokenUsage.cacheReadTokens || 0;
    const thinkingTokens = tokenUsage.thinkingTokens || 0;
    
    // 实时上下文使用量（不包括累计的 cacheReadTokens）
    const contextTokens = inputTokens + outputTokens + cacheCreationTokens + thinkingTokens;
    // 累计 token（用于显示）
    const totalTokens = inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens + thinkingTokens;

    // 获取模型信息
    const modelName = settings.model || "MiniMax-M2.5-highspeed";
    const modelDisplayName = modelName.replace(/^custom:/, "").replace(/-[0-9]+$/, "");

    // 获取 API 使用量
    let usageData = null;
    try {
      const [apiData, subscriptionData] = await Promise.all([
        api.getUsageStatus(),
        api.getSubscriptionDetails(),
      ]);
      usageData = api.parseUsageData(apiData, subscriptionData);
    } catch (e) {
      usageData = {
        usage: { percentage: 0, input: 0, output: 0, cached: 0, total: 0 },
        weekly: null,
        remaining: "未知",
        expiry: "未知",
        modelName: modelDisplayName
      };
    }

    const { usage, weekly, remaining, expiry } = usageData;

    // 获取 git 分支
    let gitBranch = null;
    try {
      const branch = require('child_process').execSync(
        'git symbolic-ref --short HEAD',
        { cwd: cwd, encoding: 'utf8', timeout: 3000 }
      ).trim();
      if (branch) {
        gitBranch = { name: branch };
        
        // 检查未提交的更改
        try {
          const status = require('child_process').execSync(
            'git status --porcelain',
            { cwd: cwd, encoding: 'utf8', timeout: 3000 }
          ).trim();
          if (status) {
            gitBranch.hasChanges = true;
          }
        } catch (e) {
          // ignore
        }
      }
    } catch (e) {
      // 非 git 目录
    }

    // 计算上下文使用量（从 session 实时 token）
    // 使用实时 contextTokens 计算百分比
    const contextUsageValue = contextTokens;
    const contextSizeValue = getContextWindowSize(modelName) || getDefaultContextWindowSize();

    // 获取 Droid 全局配置统计（不是当前工作目录）
    const droidConfigDir = path.join(process.env.HOME || process.env.USERPROFILE, ".factory");
    let configCounts = { claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0, skillsCount: 0 };
    
    try {
      const agentsPath = path.join(droidConfigDir, "agents");
      const rulesPath = path.join(droidConfigDir, "rules");
      const skillsPath = path.join(droidConfigDir, "skills");
      const hooksPath = path.join(droidConfigDir, "hooks");
      const mcpPath = path.join(droidConfigDir, "mcp.json");

      if (fs.existsSync(agentsPath)) {
        configCounts.claudeMdCount = fs.readdirSync(agentsPath).filter(f => f.endsWith(".md")).length;
      }
      if (fs.existsSync(rulesPath)) {
        configCounts.rulesCount = fs.readdirSync(rulesPath).filter(f => f.endsWith(".md")).length;
      }
      if (fs.existsSync(skillsPath)) {
        configCounts.skillsCount = fs.readdirSync(skillsPath).filter(f => f.endsWith(".md")).length;
      }
      if (fs.existsSync(hooksPath)) {
        configCounts.hooksCount = fs.readdirSync(hooksPath).filter(f => f.endsWith(".ps1") || f.endsWith(".sh")).length;
      }
      if (fs.existsSync(mcpPath)) {
        try {
          const mcpData = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
          if (mcpData.mcpServers) {
            configCounts.mcpCount = Object.keys(mcpData.mcpServers).length;
          }
        } catch (e) {}
      }
    } catch (e) {
      // ignore errors
    }

    const blocks = [];

    // 高对比度徽章配色，纯 Powerline 渲染
    if (currentDir) {
      blocks.push({ text: ` ${currentDir} `, bg: '#1D4ED8' }); // 皇家蓝
    }
    
    const useNerdFonts = !process.env.MINIMAX_PLAIN_UI && !process.env.NO_NERD_FONTS;
    const arrow = useNerdFonts ? '\uE0B0' : '>';
    const branchIcon = useNerdFonts ? '\uE0A0' : '*';

    if (gitBranch && gitBranch.name) {
      let branchStr = gitBranch.name;
      if (branchStr.length > 20) branchStr = branchStr.substring(0, 10) + '…' + branchStr.substring(branchStr.length - 7);
      if (gitBranch.hasChanges) {
        branchStr += ' *';
      }
      blocks.push({ text: ` ${branchIcon} ${branchStr} `, bg: '#7E22CE' }); // 紫色回归
    }
    
    if (usage && usage.total > 0) {
      let bg = '#065F46'; // 回归稳健的深翠绿 (Emerald 800)
      if (usage.percentage >= 95) bg = '#991B1B'; // danger (Red 800)
      else if (usage.percentage >= 75) bg = '#9A3412'; // warn (Orange 800)

      let usageText = ` ${usage.percentage}%  (${usage.remaining}/${usage.total}) `;
      if (weekly) {
        if (weekly.unlimited) {
          usageText += `· W ∞ `;
        } else {
          usageText += `· W ${weekly.percentage}% `;
        }
      }
      blocks.push({ text: usageText, bg: bg });
    }
    
    if (remaining) {
      const remainingText = remaining.hours > 0 
        ? `${remaining.hours}h${remaining.minutes}m` 
        : `${remaining.minutes}m`;
      blocks.push({ text: ` ${remainingText} `, bg: '#92400E' });
    }
    
    if (expiry) {
      let bg = '#374151'; // Gray 700
      if (expiry.daysRemaining <= 7) bg = '#9A3412';
      if (expiry.daysRemaining <= 3) bg = '#991B1B';
      blocks.push({ text: ` 剩${expiry.daysRemaining}天 `, bg: bg });
    }

    let out = '';
    const leftArrow = useNerdFonts ? '\uE0B0' : '>';
    
    for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        
        // 磁贴开启：顺行式起点，利用黑色箭头实现内凹镂空感
        if (i === 0) {
            out += '\u001b[0m' + chalk.bgHex(b.bg).black(leftArrow);
        }
        
        // 磁贴文字内容
        out += '\u001b[0m' + chalk.bgHex(b.bg).bold.whiteBright(b.text);
        
        if (i < blocks.length - 1) {
            const nextB = blocks[i + 1];
            if (useNerdFonts) {
                // 衔接尖部
                out += '\u001b[0m' + chalk.bgHex(nextB.bg).hex(b.bg)(arrow);
            } else {
                out += '\u001b[0m' + chalk.bgHex(b.bg).bold.whiteBright(arrow);
            }
        } else {
            // 最后一块磁贴：顺行式终点
            out += '\u001b[0m' + chalk.hex(b.bg)(arrow);
        }
    }
    
    console.log(out);
  });

// 模型上下文窗口大小（仅MiniMax模型）

function startWatching(api, statusBar) {
  let intervalId;

  const update = async () => {
    try {
      const apiData = await api.getUsageStatus();
      const usageData = api.parseUsageData(apiData);
      const newStatusBar = new StatusBar(usageData);

      // 清除之前的输出
      process.stdout.write("\x1Bc");

      console.log("\n" + newStatusBar.render() + "\n");
      console.log(chalk.gray(`最后更新: ${new Date().toLocaleTimeString()}`));
    } catch (error) {
      console.error(chalk.red(`更新失败: ${error.message}`));
    }
  };

  // 初始更新
  update();

  // 每10秒更新一次，以近实时更新
  intervalId = setInterval(update, 10000);

  // 处理Ctrl+C
  process.on("SIGINT", () => {
    clearInterval(intervalId);
    console.log(chalk.yellow("\n监控已停止"));
    process.exit(0);
  });
}

// 如果没有命令提供帮助
if (!process.argv.slice(2).length) {
  program.outputHelp();
  process.exit(1);
}

program.parse();
