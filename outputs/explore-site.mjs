#!/usr/bin/env node
"use strict";

/* 站点全链路探查：加载“项目工作台”并抓取每个视图的内容、交互与本地存储 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, writeFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = here + "/";

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
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

const consoleMsgs = [];
const requests = [];
page.on("console", (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => consoleMsgs.push(`[pageerror] ${String(e)}`));
page.on("request", (r) => {
  const u = r.url();
  if (!u.includes("cloudflareinsights")) requests.push(`${r.method()} ${u}`);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function snap(label) {
  const data = await page.evaluate(() => {
    const txt = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.innerText.slice(0, 4000) : null;
    };
    return {
      title: document.title,
      path: location.pathname + location.search,
      mainText: document.querySelector("main")?.innerText?.slice(0, 6000) ?? null,
      nav: Array.from(document.querySelectorAll(".nav-item, .nav-text")).map((n) => n.innerText.trim()).filter(Boolean),
      topbar: txt(".topbar"),
      storageKeys: Object.keys(localStorage),
      storage: Object.fromEntries(
        Object.keys(localStorage).map((k) => {
          let v = localStorage.getItem(k);
          try { v = JSON.parse(v); } catch {}
          return [k, v];
        })
      )
    };
  });
  writeFileSync(outDir + `site-${label}.json`, JSON.stringify(data, null, 2), "utf8");
  await page.screenshot({ path: outDir + `site-${label}.png`, fullPage: true });
  console.log(`[snap] ${label} -> path=${data.path} title=${data.title}`);
  return data;
}

/* 1) 先访问 /xian 观察行为 */
await page.goto("https://project-workbench-v014.pages.dev/xian", { waitUntil: "domcontentloaded", timeout: 60000 });
await sleep(1800);
await snap("xian");

/* 2) 访问根页面 */
await page.goto("https://project-workbench-v014.pages.dev/", { waitUntil: "domcontentloaded", timeout: 60000 });
await sleep(2500);
await snap("00-workbench");

/* 3) 遍历侧边栏视图 */
const views = [
  ["任务录入", "01-task-entry"],
  ["任务清单", "02-task-list"],
  ["项目管理", "03-projects"],
  ["日报", "04-reports"],
  ["设置", "05-settings"]
];
for (const [label, id] of views) {
  const clicked = await page.evaluate((text) => {
    const btn = Array.from(document.querySelectorAll("nav button, .nav-item")).find((b) => b.innerText.includes(text));
    if (btn) { btn.click(); return true; }
    return false;
  }, label);
  if (clicked) {
    await sleep(1200);
    await snap(id);
  } else {
    console.log(`[skip] nav not found: ${label}`);
  }
}

/* 4) 回到工作台，点顶部按钮（记事本 / AI助手 / 任务录入） */
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("nav button")).find((b) => b.innerText.includes("工作台"));
  if (btn) btn.click();
});
await sleep(800);
for (const [label, id] of [["记事本", "06-notepad"], ["AI助手", "07-ai"], ["任务录入", "08-top-entry"]]) {
  const clicked = await page.evaluate((text) => {
    const btn = Array.from(document.querySelectorAll("main button, .topbar button, .btn")).find((b) => b.innerText.includes(text));
    if (btn) { btn.click(); return true; }
    return false;
  }, label);
  if (clicked) {
    await sleep(1500);
    await snap(id);
  }
}

/* 5) 工作台内的“知道了”引导与 AI 助手弹层（尽量触发） */
await page.evaluate(() => {
  Array.from(document.querySelectorAll("button")).forEach((b) => {
    if (b.innerText.includes("知道了")) b.click();
  });
});
await sleep(600);
await snap("09-after-guide");

/* 6) 尝试常见输入交互：在输入框填内容看是否有表单 */
const forms = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("input, textarea, select")).map((el) => ({
    tag: el.tagName,
    type: el.type || "",
    placeholder: el.placeholder || "",
    name: el.name || "",
    id: el.id || ""
  }));
});
writeFileSync(outDir + "site-forms.json", JSON.stringify({ forms, consoleMsgs, requests }, null, 2), "utf8");

console.log("== console ==");
console.log(consoleMsgs.join("\n"));
console.log("== requests ==");
console.log(requests.slice(0, 80).join("\n"));

await browser.close();
