# project-004 · Leave a Trace（留痕）

| 项目名称 | Leave a Trace（留痕） |
|----------|----------------------|
| 项目状态 | 📝 方案待评审 · M1 前端原型已交付（2026-08-06 创建） |
| 项目类型 | 桌面端纯本地应用（设计阶段） |
| 文档 | [留痕项目设计方案](docs/留痕项目设计方案.md) |

## 项目简介

纯本地的桌面端个人工作记录工具：每日任务三态记录 + 打卡动效 + 时限渐变/逾期跟进 + 日/周/月热力图 + 月度汇总（生成 PDF/MD）+ 文件库（xlsx/PDF）+ 全局搜索 + JSON 备份恢复。数据输入即保存到本地后端（SQLite 数据库 + 文件落盘），无云依赖。

## 前端原型（M1，浏览器直接可跑）

位置：`src/web/`，纯 HTML/CSS/JS、零依赖、无需构建。双击 `src/web/index.html` 即可在浏览器打开验收。

已实现：任务三态（进行中/已完成/未完成）、输入即存、快捷截止时间（`任务名 18:00`）、完成打勾动效、临近渐变、逾期跟进（顺延/放弃）、每日打卡动效、90 天热力图、**月度汇总（MD 生成/PDF 导出/归档文件库）**、**文件库（拖拽导入/xlsx·PDF·图片·文本预览/标签/下载）**、**全局搜索（任务/文件/月报，跳转定位高亮）**、演示数据、JSON 导出/导入、损坏恢复向导、三套可切换风格（纸感手账 / 墨夜深色 / 现代克制）、**Electron 桌面壳（磁盘资料库/系统打开/文件夹定位/PDF 另存）**。

验证：`outputs/smoke.mjs`、`outputs/smoke-workbench.mjs`、`outputs/smoke-m3.mjs`、`outputs/smoke-desktop.mjs`（Playwright 无头冒烟测试）全部通过、零控制台报错，截图见 `outputs/prototype-*.png` 与 `outputs/workbench-*.png`。

## 项目工作台模块（复刻 project-workbench-v014）

侧边栏「项目工作台」（`#workbench`）新增了工作台 / 任务录入 / 任务清单 / 项目管理 / 日报周报 / 记事本 / AI 助手 / 设置，功能与目标站点一致，数据存独立键 `trace:workbench:v1`，与留痕主数据互不影响。全链路分析与复刻说明见 [docs/项目工作台全链路分析.md](docs/项目工作台全链路分析.md)。

验证：`outputs/smoke-workbench.mjs` 通过（录入解析、筛选、建项目、甘特、日报、记事本、设置），截图见 `outputs/workbench-*.png`。

## 运行与部署

### 方式零：桌面版（Electron）

```powershell
npm start
```

桌面版（Electron 35，内置 Node 22）与 Web 后端共用同一套数据库层（`electron/trace-db.cjs`）：状态写入 SQLite `data/trace.db`，文件统一落 `data/files/`，不再使用 localStorage / 磁盘资料库。

- 开发运行（`npm start`）：数据存项目 `data/`，与 Web 服务完全同一份
- 打包运行：默认存 `%APPDATA%\留痕\data`；如需与 Web/项目共用，设置环境变量 `TRACE_DATA_DIR` 指向项目 `data` 目录
- 已生成安装包：`release\留痕-1.0.7-setup.exe`（Electron 35.7.5）
- 桌面版保留的系统能力：月报导出 PDF 另存、桌面通知

重新打包安装包：

```powershell
npm run dist
```

### 方式一：一键启动（推荐日常使用，含后端与数据库）

双击项目根目录的 `start.bat`，或运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start.ps1
```

脚本会启动一个零依赖的本地后端服务（`http://127.0.0.1:8787/`）并用默认浏览器打开。该服务同时提供：

- 前端静态站点（`src/web/`）
- REST API（状态读写、文件上传/下载/删除）
- SQLite 数据库（`data/trace.db`，存应用状态）
- 文件落盘存储（`data/files/<id>/`，存上传文件本体）

前端通过 HTTP 打开时会自动切换到“服务模式”：数据读写走后端 API，文件上传落盘到服务器，局域网内其他设备可通过 `http://<本机IP>:8787/` 使用同一份数据。直接双击 `src/web/index.html` 打开时自动回退到 localStorage 模式，功能不受影响。

### 方式二：直接打开原型（M1 验收用）

双击 `src/web/index.html` 即可在浏览器打开，无需任何构建步骤。

### 验证（冒烟测试）

```powershell
node outputs\smoke.mjs
node outputs\smoke-workbench.mjs
node outputs\smoke-m3.mjs
node outputs\smoke-desktop.mjs
```

脚本自动定位项目目录与本机 Playwright/Edge 运行时。`smoke.mjs` 覆盖留痕原有功能，`smoke-workbench.mjs` 覆盖项目工作台，`smoke-m3.mjs` 覆盖月度汇总/搜索/文件库，`smoke-desktop.mjs` 覆盖 Electron 桌面壳。

## 目录结构

```
project-004\
├── README.md                 ← 项目说明
├── docs\                     ← 设计文档
│   ├── 留痕项目设计方案.md    ← 方案书（第一次交流稿）
│   └── 项目工作台全链路分析.md ← 目标站点分析 + 复刻说明
├── src\web\                  ← 前端原型（M1 已交付 + 项目工作台模块）
│   ├── vendor\               ← 本地依赖（SheetJS，纯本地无 CDN）
├── scripts\                  ← 本地启动脚本（serve.mjs / start.ps1）
├── start.bat                 ← 双击一键启动
├── electron\                 ← Electron 桌面壳（main.cjs / preload.cjs / trace-db.cjs 统一数据库层）
├── package.json              ← 桌面版依赖与打包配置
├── data\                     ← 运行时数据（SQLite 数据库 + 上传文件本体，已 gitignore）
└── outputs\                  ← 冒烟测试脚本与截图
```

## 部署路线（按方案书第 7 章）

M0 方案评审 → M1 核心闭环（已交付）→ M2 热力图（日视图已交付）→ M3 文件库 + 搜索 + 月报（已交付）→ M4 备份体系（JSON 导出/导入、快照、损坏恢复已交付）→ M5 Electron 套壳（开发版已可运行，安装包可用 `npm run dist` 生成）。

## 关键决策（待评审）

- 技术路线（已确认）：纯网页原型先行（M1 交付可验收原型），再 Electron 套壳补齐系统能力
- 文件入库：默认复制入库，保留"仅索引"可选
- 存储：服务模式与桌面端统一走数据库（SQLite 单表 `app_state` 存状态 JSON + `files` 表存文件元数据、文件本体落盘 `data/files/`），浏览器直开时回退 localStorage 单键 `trace:v1`
- 后端：Node ≥ 22.5 内置 `node:sqlite`，零 npm 依赖；详见 [docs/后端架构与数据库.md](docs/后端架构与数据库.md)
- 热力图：对标 90 天计划参考实现的日/周/月三视图
- 月度汇总（已确认）：MD 与 PDF 两种格式都做，生成物自动归档进文件库

## 状态流转

M0 方案评审（进行中）→ M1 核心闭环（原型已交付，待验收）→ M2 热力图 → M3 文件库+搜索+月报 → M4 备份体系 → M5 Electron 套壳打磨
