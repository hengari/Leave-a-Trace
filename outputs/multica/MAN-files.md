背景：F:\workpaces\project-004\project-004\src\web 是"留痕"桌面端纯本地应用的前端原型（纯 HTML/CSS/JS、无构建依赖）。应用数据以 JSON 存于 localStorage 键 "trace:v1"，其中 files 数组存文件索引：{ id, name, type, size, date: "YYYY-MM-DD", tags, path, importedAt }。你可读取 js/app.js 确认结构，但严禁修改它。设计文档：F:\workpaces\project-004\project-004\docs\留痕项目设计方案.md 第 3.6 节。

任务：为原型新增"文件库模块"，只新增文件，不改任何现有文件。

交付物（只允许新增）：
js/file-library.js —— 原生 JS、零依赖、中文注释。必须暴露两个全局函数：
- renderFileLibrary(container)：在传入容器内渲染文件库视图——按日期分组（年 → 月 → 日）列出 files 索引，每条显示名称、类型徽标（xlsx/pdf/csv 等）、大小、标签；文件缺失时标记"文件已移动"；空态提示。
- registerFileImport()：注册"选择文件/拖拽文件"导入入口，导入时把文件元信息（name、type、size、date=今天、tags 可空、path=文件名占位）追加写入 localStorage("trace:v1").files，并调用 renderFileLibrary 刷新；原型阶段只登记元信息，不做二进制复制。

硬性约束：
- 严禁修改 index.html、css/app.css、js/app.js、app.css 及任何现有文件；
- 遵循 karpathy-guidelines：简洁、不过度设计、可验证；
- 写操作必须走 try/catch，失败时用 alert 或 console.error 明确提示；
- 完成后在评论中给出：文件路径、API 说明、数据结构示例、自测结果。
