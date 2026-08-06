#!/usr/bin/env node
"use strict";

/* 为项目工作台各视图生成截图 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "src", "web");
const out = here + "/";
const url = "file:///" + root.replace(/\\/g, "/") + "/index.html";

const runtimeNodeModules = "C:/Users/liuheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/";
const require = createRequire(runtimeNodeModules);
const { chromium } = require("playwright");
const executablePath = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await sleep(1200);
await page.click('a[href="#workbench"]');
await sleep(600);
await page.screenshot({ path: out + "workbench-home.png", fullPage: true });

/* 录入 + 预览 */
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
await page.evaluate(() => document.querySelector(".wb-intake-textarea").style.height = "auto");
await page.evaluate(() => document.querySelector(".wb-intake-textarea").style.height = document.querySelector(".wb-intake-textarea").scrollHeight + "px");
await page.locator('#view-workbench button:has-text("生成任务预览")').first().click();
await sleep(400);
await page.screenshot({ path: out + "workbench-intake-preview.png", fullPage: true });
await page.locator('#view-workbench button:has-text("确认导入选中任务")').first().click();
await sleep(500);

/* 任务清单 */
await page.click('.wb-nav-item[data-wb="tasks"]');
await sleep(400);
await page.screenshot({ path: out + "workbench-tasks.png", fullPage: true });

/* 任务详情 */
await page.evaluate(() => {
  const btn = document.querySelector(".wb-table-row .wb-row-actions button:first-child");
  if (btn) btn.click();
});
await sleep(400);
await page.screenshot({ path: out + "workbench-task-detail.png", fullPage: true });
await page.click("#wb-task-modal .wb-modal-cancel");
await sleep(300);

/* 项目管理 */
await page.click('.wb-nav-item[data-wb="projects"]');
await sleep(300);
await page.screenshot({ path: out + "workbench-projects.png", fullPage: true });

/* 日报 */
await page.click('.wb-nav-item[data-wb="reports"]');
await sleep(300);
await page.screenshot({ path: out + "workbench-reports.png", fullPage: true });

/* AI 助手 */
await page.click("#wb-ai-btn");
await sleep(400);
await page.screenshot({ path: out + "workbench-ai.png", fullPage: true });
await page.click("#wb-ai-modal .wb-modal-cancel");
await sleep(300);

/* 深色主题下的工作台 */
await page.evaluate(() => { localStorage.setItem("trace:style", "dark"); document.documentElement.dataset.theme = "dark"; });
await page.click('.wb-nav-item[data-wb="home"]');
await sleep(400);
await page.screenshot({ path: out + "workbench-home-dark.png", fullPage: true });

await browser.close();
console.log("screenshots done");
