#!/usr/bin/env node
"use strict";

/* 项目工作台模块冒烟测试：覆盖录入解析、任务清单、项目、日报、记事本、设置 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "src", "web");
const url = "file:///" + root.replace(/\\/g, "/") + "/index.html";

const runtimeCandidates = [
  "C:/Users/liuheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/",
  "C:/Users/19909/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/"
];
const runtimeNodeModules = runtimeCandidates.find((p) => existsSync(p));
const require = createRequire(runtimeNodeModules);
const { chromium } = require("playwright");

const edgeCandidates = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"
];
const executablePath = edgeCandidates.find((p) => existsSync(p));
const browser = await chromium.launch(executablePath ? { executablePath } : { channel: "msedge" });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clickText = async (text) => {
  let loc = page.locator(`#view-workbench button:has-text("${text}")`);
  if ((await loc.count()) === 0) loc = page.locator(`button:has-text("${text}")`);
  await loc.first().click();
};

const report = {};
try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(1200);

  /* 进入项目工作台 */
  await page.click('a[href="#workbench"]');
  await sleep(600);
  report.wbVisible = await page.evaluate(() => !!document.getElementById("view-workbench"));
  report.navItems = await page.evaluate(() => Array.from(document.querySelectorAll(".wb-nav-item")).map((b) => b.textContent.trim()));
  report.homeStats = await page.evaluate(() => document.querySelectorAll(".wb-stat").length);

  /* 任务录入：粘贴 AI 卡片文本 */
  await page.click('.wb-nav-item[data-wb="intake"]');
  await sleep(300);
  const cardText = `【任务1】
任务名称：跟进消防通道整改时间
所属项目：个人待办
归类状态：待归类
负责人：我
截止时间：明天
优先级：高
来源：微信群
备注：相关人：王工

【任务2】
任务名称：整理项目方案初稿
所属项目：个人待办
归类状态：已归类
负责人：未明确
截止时间：本周五
优先级：中
来源：会议纪要
备注：无`;
  await page.fill("#wb-intake-text", cardText);
  await clickText("生成任务预览");
  await sleep(400);
  report.previewCount = await page.evaluate(() => document.querySelectorAll(".wb-preview-card").length);
  await clickText("确认导入选中任务");
  await sleep(500);
  report.tasksAfterImport = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("trace:workbench:v1") || "{}");
    return { tasks: raw.tasks ? raw.tasks.length : 0, titles: raw.tasks ? raw.tasks.map((t) => t.title) : [] };
  });
  report.taskRows = await page.evaluate(() => document.querySelectorAll(".wb-table-row").length);

  /* 任务清单：筛选 + 完成 */
  await page.click('.wb-filters button:has-text("已逾期")');
  await sleep(250);
  report.overdueRows = await page.evaluate(() => document.querySelectorAll(".wb-table-row").length);
  await page.click('.wb-filters button:has-text("全部")');
  await sleep(250);
  await page.evaluate(() => {
    const btn = document.querySelector(".wb-table-row .wb-row-actions button:last-child");
    if (btn) btn.click();
  });
  await sleep(400);
  report.doneCount = await page.evaluate(() => JSON.parse(localStorage.getItem("trace:workbench:v1")).tasks.filter((t) => t.status === "已完成").length);

  /* 项目管理：新建项目 */
  await page.click('.wb-nav-item[data-wb="projects"]');
  await sleep(300);
  await clickText("+ 新建项目");
  await sleep(250);
  await page.fill("#wb-new-project-name", "消防整改");
  await page.fill("#wb-new-project-desc", "通道整改与验收");
  await clickText("创建项目");
  await sleep(400);
  report.projectCards = await page.evaluate(() => Array.from(document.querySelectorAll(".wb-project-title")).map((e) => e.textContent.trim()));

  /* 排期甘特 */
  await page.click('.wb-switch-tabs button:has-text("排期甘特")');
  await sleep(300);
  report.ganttRows = await page.evaluate(() => document.querySelectorAll(".wb-gantt-row").length);

  /* 日报/周报 */
  await page.click('.wb-nav-item[data-wb="reports"]');
  await sleep(300);
  report.reportBody = await page.evaluate(() => (document.querySelector(".wb-report-body pre") || { textContent: "" }).textContent.slice(0, 60));
  await clickText("保存记录");
  await sleep(300);
  await page.click('.wb-switch-tabs button:has-text("历史记录")');
  await sleep(300);
  report.historyCount = await page.evaluate(() => document.querySelectorAll(".wb-history-card").length);

  /* 记事本 */
  await page.click("#wb-notepad-btn");
  await sleep(300);
  await page.fill("#wb-notepad-input", "下午把消防通道整改时间跟进一下");
  await clickText("保存到记事本");
  await sleep(400);
  report.inboxCount = await page.evaluate(() => JSON.parse(localStorage.getItem("trace:workbench:v1")).inbox.length);
  report.homeInbox = await page.evaluate(() => document.querySelectorAll(".wb-inbox-item").length);

  /* 设置 */
  await page.click('.wb-nav-item[data-wb="settings"]');
  await sleep(300);
  report.settingsPanels = await page.evaluate(() => Array.from(document.querySelectorAll("#wb-settings .wb-panel h2")).map((e) => e.textContent.trim()));
} catch (err) {
  report.failedAt = String(err).split("\n")[0];
}

report.errors = errors;
console.log(JSON.stringify(report, null, 2));
await browser.close();
