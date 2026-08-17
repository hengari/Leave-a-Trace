---
name: deploy-liuhen-sync
description: 在全新电脑(如公司电脑)上用 ZCode 一键部署"留痕"(Leave a Trace)的坚果云 WebDAV 跨设备同步服务。当用户提到"部署留痕同步"、"公司电脑同步"、"新电脑装留痕"、"跑同步服务"、"打开网页版留痕"、"deploy liuhen sync"、"同步坚果云"或给出 github.com/hengari/Leave-a-Trace 仓库时使用——即使没有明说"部署"也要主动使用。
---

# 部署留痕跨设备同步服务

## 这是什么

在一台新电脑上运行"留痕"网页端同步服务：本机跑 `scripts/serve.mjs`（零依赖，只要 Node），数据自动经坚果云 WebDAV 与家里/其他电脑双向同步。用户日常用浏览器访问 `http://localhost:8787` 写任务即可。

架构一句话：**网页端(本机) ⇄ SQLite(本机) ⇄ 坚果云 WebDAV(云端) ⇄ 其他电脑**。

## 前置检查（依次执行，缺什么装什么）

1. **Node.js ≥ 22.13**（需要内置 `node:sqlite`）：
   - `node --version` 检查；版本过低或没有则 `winget install OpenJS.NodeJS.LTS`，装完新开终端再验证
   - 如果 winget 不可用，提示用户从 https://nodejs.org 下载 LTS 安装包
2. **Git**：`git --version` 检查；没有则 `winget install Git.Git`
3. **网络**：测试 `curl -s --max-time 15 https://dav.jianguoyun.com` 是否可达
   - 不可达：报告用户"公司网络无法访问坚果云 WebDAV，同步方案不可用"，停止并讨论替代方案

## 部署步骤

### 1. 获取代码

- 若当前目录已是留痕仓库（存在 `start-sync-server.bat` 或 `package.json` 且 name 为 liuhen-desktop）：先 `git pull` 拉最新
- 否则克隆：`git clone https://github.com/hengari/Leave-a-Trace.git` 到合适目录（如 `D:\workspace\Leave-a-Trace`），`cd` 进去

### 2. 创建同步配置（关键一步，涉及密码）

- 复制模板：`copy sync-config.example.json sync-config.json`
- **向用户索取两个信息**（提示用户从家里那台电脑的 `sync-config.json` 复制，或直接输入）：
  - 坚果云注册邮箱
  - 坚果云应用密码（不是登录密码）
- 写入 `sync-config.json` 的 `username` / `password` 字段
- `url` 字段保持 `https://dav.jianguoyun.com/dav/liuhen-task/trace-state.json`
- **红线：`sync-config.json` 含密码，已在 .gitignore 中，绝不 `git add` / `git commit` / `git push` 它**

### 3. 验证云端连通性

```bash
curl -s -X PROPFIND -u "邮箱:应用密码" -H "Depth: 1" https://dav.jianguoyun.com/dav/ | grep -oE "<d:href>[^<]*</d:href>"
```

- 应列出 `liuhen-task/` 文件夹
- 401 = 邮箱/应用密码错误；无 `liuhen-task` = 文件夹名不对（列出实际文件夹名后修正 url）

### 4. 启动服务

```bash
node scripts/serve.mjs
```

（或双击 `start-sync-server.bat`，它会在 2 秒后自动打开浏览器）

### 5. 验证（按顺序，全部通过才算完成）

先运行内置验证脚本（自动检查环境/配置/云端/服务/数据一致性）：

```bash
node .zcode/skills/deploy-liuhen-sync/scripts/verify-sync.mjs
```

脚本输出有 FAIL 时，按下方手动步骤逐项排查：

1. `curl http://127.0.0.1:8787/api/health` → `{"ok":true,...}`
2. `curl http://127.0.0.1:8787/api/state` → 任务数与家里/云端一致（可用 node 统计 `days` 下任务总数）
3. 服务日志出现 `云端同步：已启用` 以及 `[sync]` 开头的同步结果
4. 云端文件存在：`curl -u "邮箱:应用密码" -o /dev/null -w "%{http_code}" https://dav.jianguoyun.com/dav/liuhen-task/trace-state.json` → 200
5. 打开浏览器访问 `http://127.0.0.1:8787/`，确认页面加载且任务列表正确

### 6. 收尾

- 告诉用户日常使用方式：双击 `start-sync-server.bat`，浏览器打开 `http://127.0.0.1:8787`
- 告诉用户桌面端需要重启才显示最新数据，网页端刷新即可
- 可选：配置开机自启（任务计划程序运行 `start-sync-server.bat`，或 `shell:startup` 放快捷方式）

## 常见问题

| 现象 | 处理 |
|------|------|
| `EADDRINUSE` 8787 端口被占 | 先 `curl http://127.0.0.1:8787/api/health`——若返回 ok 说明服务已在跑，直接验证即可；否则用 `netstat -ano | findstr 8787` 找进程清理 |
| WebDAV 401 | 应用密码错误或未启用；重新向用户确认 |
| WebDAV 404/文件夹不存在 | PROPFIND 根目录列出实际文件夹名，修正 url |
| 同步日志报错 `[sync] 失败` | 看错误内容：超时=网络问题；HTTP 4xx=认证/路径问题 |
| `node:sqlite` 找不到 | Node 版本 < 22.13，需要升级 |

## 安全与边界

- `sync-config.json` 是唯一含密码的文件，已 gitignore，任何情况下不提交
- 服务只监听本机/局域网（0.0.0.0），公司电脑若不想暴露局域网访问，启动时说明即可（可用 `--port` 换端口）
- 同步的是任务/月报/设置；文件库附件本体不跨端同步
