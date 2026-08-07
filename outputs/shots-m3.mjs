#!/usr/bin/env node
"use strict";

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, writeFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const out = here + "/";
const root = resolve(here, "..", "src", "web");
const url = "file:///" + root.replace(/\\/g, "/") + "/index.html";
const cr = createRequire("C:/Users/liuheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const { chromium } = cr("playwright");
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await sleep(1200);

/* 月度汇总 */
await page.click('a[href="#monthly"]');
await sleep(400);
await page.screenshot({ path: out + "monthly-overview.png", fullPage: true });
await page.click("#monthly-gen-md");
await sleep(400);
await page.screenshot({ path: out + "monthly-md-preview.png", fullPage: true });
await page.click("#monthly-preview-close");
await sleep(200);

/* 文件库：导入 txt + xlsx 并预览 */
const XLSX = cr(resolve(here, "..", "src", "web", "vendor", "xlsx.full.min.js"));
const sampleTxt = out + "sample-notes.txt";
const sampleXlsx = out + "sample-sheet.xlsx";
writeFileSync(sampleTxt, "月度复盘要点：消防通道整改、客户回访、方案初稿\n", "utf8");
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["任务", "状态"], ["消防整改", "进行中"], ["客户回访", "待开始"]]), "Sheet1");
writeFileSync(sampleXlsx, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

await page.click('a[href="#files"]');
await sleep(300);
await page.setInputFiles("#file-input", [sampleTxt, sampleXlsx]);
await sleep(700);
await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll("#file-list .file-item"));
  const row = rows.find((r) => r.textContent.includes("sample-sheet"));
  if (row) {
    const btn = Array.from(row.querySelectorAll(".row-actions button")).find((b) => b.textContent === "预览");
    if (btn) btn.click();
  }
});
await sleep(900);
await page.screenshot({ path: out + "files-library.png", fullPage: true });

/* 全局搜索 */
await page.fill("#search-input", "客户");
await sleep(500);
await page.screenshot({ path: out + "search-results.png", fullPage: true });

await browser.close();
console.log("shots done");
