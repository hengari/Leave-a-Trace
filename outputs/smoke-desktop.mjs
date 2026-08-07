#!/usr/bin/env node
"use strict";

/* Electron 桌面壳冒烟测试：启动、页面加载、桌面 API、附件落盘 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, unlinkSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const cr = createRequire("C:/Users/liuheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const { _electron } = cr("playwright");

const electronExe = resolve(projectRoot, "node_modules", "electron", "dist", "electron.exe");
const report = {};

const app = await _electron.launch({
  executablePath: existsSync(electronExe) ? electronExe : undefined,
  args: [projectRoot],
  cwd: projectRoot
});
const errors = [];
try {
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded", { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1800));
  win.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  win.on("pageerror", (e) => errors.push(String(e)));

  report.title = await win.title();
  report.hasDesktopApi = await win.evaluate(() => !!(window.traceDesktop && window.traceDesktop.isDesktop));
  report.libRoot = await win.evaluate(() => window.traceDesktop.getLibraryRoot());
  report.appData = await win.evaluate(() => {
    const raw = localStorage.getItem("trace:v1");
    const s = raw ? JSON.parse(raw) : null;
    return {
      hasTrace: !!s,
      days: s ? Object.keys(s.days).length : 0,
      wbKey: !!localStorage.getItem("trace:workbench:v1")
    };
  });

  /* 附件落盘测试 */
  const saved = await win.evaluate(() => window.traceDesktop.saveAttachment({
    name: "desktop-smoke.txt",
    dataUrl: "data:text/plain;base64," + btoa("desktop-smoke-ok"),
    subPath: "attachments/2026/08"
  }));
  report.saved = saved;
  if (saved && saved.ok) {
    report.fileOnDisk = existsSync(saved.path);
    try { unlinkSync(saved.path); } catch (e) {}
  }

  /* 页面功能抽查：月度指标与搜索 */
  await win.click('a[href="#monthly"]');
  await new Promise((r) => setTimeout(r, 500));
  report.monthlyMetrics = await win.evaluate(() => document.querySelectorAll("#monthly-metrics .metric").length);
  await win.fill("#search-input", "客户");
  await new Promise((r) => setTimeout(r, 500));
  report.searchResults = await win.evaluate(() => document.querySelectorAll("#search-results .search-item").length);
} catch (err) {
  report.failedAt = String(err).split("\n")[0];
} finally {
  report.errors = errors;
  console.log(JSON.stringify(report, null, 2));
  await app.close();
}
