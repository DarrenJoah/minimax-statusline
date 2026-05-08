# MiniMax/GLM Claude Code StatusLine Tools

Claude Code 状态栏集成工具，支持 MiniMax 和 GLM 模型额度监控。

## 目录结构

```
minimax-statusline/   新工具（MiniMax 模型使用）
model-statusline/     旧工具（GLM 模型使用）
```

## 工具分工

| 模型 | 工具 | 配置 |
|------|------|------|
| **MiniMax** | `minimax-statusline/` (新工具) | `minimax-status statusline --no-bar` |
| **GLM** | `model-statusline/` (旧工具) | 指向 `model-statusline` 路径 |

## 快速开始

### MiniMax 模型

```bash
# 安装
npm install -g minimax-status

# Claude Code 配置 (~/.claude/settings.json)
{
  "statusLine": {
    "type": "command",
    "command": "minimax-status statusline --no-bar"
  }
}
```

### GLM 模型

```bash
# Claude Code 配置 (~/.claude/settings.json)
{
  "statusLine": {
    "type": "command",
    "command": "/opt/homebrew/Cellar/node/24.3.0/bin/node /Users/zhangchaocun/Projects/minimax-statusline/model-statusline/cli/index.js"
  },
  "hooks": {
    "SessionStart": [
      { "matcher": "startup", "hooks": [{ "type": "command", "command": "/opt/homebrew/Cellar/node/24.3.0/bin/node /Users/zhangchaocun/Projects/minimax-statusline/model-statusline/cli/index.js session-start-refresh" }] },
      { "matcher": "resume", "hooks": [{ "type": "command", "command": "/opt/homebrew/Cellar/node/24.3.0/bin/node /Users/zhangchaocun/Projects/minimax-statusline/model-statusline/cli/index.js session-start-refresh" }] },
      { "matcher": "clear", "hooks": [{ "type": "command", "command": "/opt/homebrew/Cellar/node/24.3.0/bin/node /Users/zhangchaocun/Projects/minimax-statusline/model-statusline/cli/index.js session-start-refresh" }] }
    ]
  }
}
```

## 显示格式

```
模型名 | ctx 使用率 | 5h 使用率 | 5h重置时间 | W 使用率 | W:reset 重置日期
```

示例：`GLM Lite | ctx 57% | 5h used 74% | reset 21:49 | week 17% | W:reset 05-14 19:11`

## 颜色说明

| 元素 | 颜色 |
|------|------|
| 模型名 | 青色 (cyan) |
| ctx | 绿色 (green) |
| 5h | 紫红色 (magenta) |
| reset | 蓝色 (blue) |
| W | 黄色 (yellow) |
| W:reset | 紫红色 (magenta) |

## TODO

- [ ] 统一使用 `minimax-statusline` 新工具，不再依赖 `model-statusline`
- [ ] 在新工具中补齐 GLM provider 的所有功能

## 导航

| 工具 | 路径 |
|------|------|
| **minimax-statusline** | [`minimax-statusline/`](minimax-statusline/) |
| **model-statusline** | [`model-statusline/`](model-statusline/) |

---

**注意**: Claude Code 会自动重写 `settings.json` 的 env 部分，两套模型配置无法同时生效。切换模型时需要配合路由脚本或手动调整配置。