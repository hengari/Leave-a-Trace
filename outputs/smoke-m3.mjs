#!/usr/bin/env node
"use strict";

/* 方案书 M3 冒烟测试：月度汇总 / 全局搜索 / 文件库 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, writeFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "src", "web");
const out = here + "/";
const url = "file:///" + root.replace(/\\/g, "/") + "/index.html";

const runtimeNodeModules = "C:/Users/liuheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/";
const cr = createRequire(runtimeNodeModules);
const { chromium } = cr("playwright");
const executablePath = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

/* 准备测试文件：txt 与 xlsx（用本地 SheetJS 生成） */
const XLSX = cr(resolve(here, "..", "src", "web", "vendor", "xlsx.full.min.js"));
const sampleTxt = out + "sample-notes.txt";
const sampleXlsx = out + "sample-sheet.xlsx";
writeFileSync(sampleTxt, "月度复盘要点：消防通道整改、客户回访、方案初稿\n", "utf8");
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([["任务", "状态"], ["消防整改", "进行中"], ["客户回访", "待开始"]]);
XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
const xlsxBuf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
writeFileSync(sampleXlsx, xlsxBuf);

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const report = {};
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await sleep(1200);

/* ---- 月度汇总 ---- */
await page.click('a[href="#monthly"]');
await sleep(400);
report.monthlyMetrics = await page.evaluate(() =>
  Array.from(document.querySelectorAll("#monthly-metrics .metric")).map((m) => m.textContent.trim())
);
report.monthlyHeatCells = await page.evaluate(() => document.querySelectorAll("#monthly-heatmap .hm-cell").length);
report.monthlyDays = await page.evaluate(() => document.querySelectorAll(".month-day-title").length);
await page.click("#monthly-gen-md");
await sleep(500);
report.mdPreviewVisible = await page.evaluate(() => !document.getElementById("monthly-preview-modal").classList.contains("hidden"));
report.mdPreviewLen = await page.evaluate(() => document.getElementById("monthly-preview-content").textContent.length);
report.mdRegistered = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("trace:v1"));
  return {
    reports: s.monthlyReports.length,
    files: s.files.length,
    fileNames: s.files.map((f) => f.name)
  };
});
await page.click("#monthly-preview-close");
await sleep(300);

/* ---- 全局搜索 ---- */
await page.fill("#search-input", "客户");
await sleep(500);
report.searchGroups = await page.evaluate(() => Array.from(document.querySelectorAll("#search-results .search-group-title")).map((e) => e.textContent));
report.searchItems = await page.evaluate(() => Array.from(document.querySelectorAll("#search-results .search-item")).map((e) => e.textContent.trim()));
await page.evaluate(() => {
  const btn = document.querySelector("#search-results .search-item");
  if (btn) btn.click();
});
await sleep(600);
report.searchNavigated = await page.evaluate(() => ({
  page: document.body.dataset.page,
  hit: !!document.querySelector(".task-row.search-hit"),
  activeDate: document.getElementById("day-sub") ? document.getElementById("day-sub").textContent : ""
}));

/* ---- 文件库 ---- */
await page.click('a[href="#files"]');
await sleep(400);
await page.setInputFiles("#file-input", [sampleTxt]);
await sleep(600);
report.filesAfterImport = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("trace:v1"));
  return { count: s.files.length, name: s.files[0] && s.files[0].name, mode: s.files[0] && s.files[0].mode };
});
report.fileRows = await page.evaluate(() => document.querySelectorAll("#file-list .file-item").length);
/* 预览文本文件 */
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("#file-list .file-item .row-actions button")).find((b) => b.textContent === "预览");
  if (btn) btn.click();
});
await sleep(400);
report.txtPreview = await page.evaluate(() => {
  const pre = document.querySelector("#file-list .file-preview pre");
  return pre ? pre.textContent.slice(0, 40) : null;
});
/* 导入 xlsx 并预览（SheetJS） */
await page.setInputFiles("#file-input", [sampleXlsx]);
await sleep(500);
await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll("#file-list .file-item"));
  const row = rows.find((r) => r.textContent.includes("sample-sheet"));
  if (row) {
    const btn = Array.from(row.querySelectorAll(".row-actions button")).find((b) => b.textContent === "预览");
    if (btn) btn.click();
  }
});
await sleep(800);
report.sheetPreview = await page.evaluate(() => {
  const table = document.querySelector("#file-list .file-preview table");
  return table ? table.rows.length : 0;
});

report.errors = errors;
console.log(JSON.stringify(report, null, 2));
await browser.close();
