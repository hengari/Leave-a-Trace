背景：F:\workpaces\project-004\project-004\src\web 是"留痕"桌面端纯本地应用的前端原型（纯 HTML/CSS/JS、无构建依赖）。应用数据以 JSON 存于 localStorage 键 "trace:v1"，结构为 { meta, days: { "YYYY-MM-DD": { tasks: [...], checkIn } }, files: [...], settings }；任务字段含 text、status（in_progress|done|pending）、deadline、createdAt、completedAt、tags、note。你可读取 js/app.js 确认结构，但严禁修改它。设计文档：F:\workpaces\project-004\project-004\docs\留痕项目设计方案.md 第 3.5 节。

任务：为原型新增"月度汇总 · Markdown 月报生成器"能力，只新增文件，不改任何现有文件。

交付物（只允许新增）：
1. js/monthly-report.js —— 原生 JS、零依赖、中文注释。必须暴露两个全局函数：
   - buildMonthlyReportMD(year, month)：读取 localStorage("trace:v1")，聚合该自然月的 days：统计总任务数、已完成、完成率、进行中、未完成、逾期数、打卡天数；按日输出 Markdown（标题 + 概览表 + 按日清单：每行日期 + 任务（✓ 已完成 / ● 进行中 / ◌ 未完成，附截止时间 HH:mm、标签、备注）+ 需跟进清单）；返回 Markdown 字符串。
   - renderMonthlyReport(container)：在传入的 DOM 容器中渲染当月（当前年月）概览指标与"生成 Markdown"按钮，点击后展示/下载生成的 Markdown。
2. 可选：monthly-report-template.md 模板文件。

硬性约束：
- 严禁修改 index.html、css/app.css、js/app.js、app.css 及任何现有文件；
- 遵循 karpathy-guidelines：简洁、不过度设计、可验证；
- 日期键严格使用 YYYY-MM-DD 本地日期，不跨时区混淆；
- 完成后在评论中给出：文件路径、函数签名与调用示例、当月数据生成的 Markdown 样例（截取一段即可）。
