import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

/* 路径自适应：以本脚本所在目录为基准，自动定位 src/web、outputs 与 Playwright 运行时 */
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "src", "web");
const out = resolve(here, "..", "outputs") + "/";
const url = "file:///" + root.replace(/\\/g, "/") + "/index.html";

const runtimeCandidates = [
  "C:/Users/liuheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/",
  "C:/Users/19909/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/"
];
const runtimeNodeModules = runtimeCandidates.find((p) => existsSync(p));
if (!runtimeNodeModules) {
  console.error("未找到 Playwright 运行时（codex-runtimes node_modules），请检查环境。");
  process.exit(1);
}
const require = createRequire(runtimeNodeModules);
const { chromium } = require("playwright");

const edgeCandidates = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"
];
const executablePath = edgeCandidates.find((p) => existsSync(p));
const launchOpts = executablePath ? { executablePath } : { channel: "msedge" };

const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
page.on("pageerror", (err) => errors.push(String(err)));

await page.goto(url);
await page.waitForTimeout(700);

const info = await page.evaluate(() => ({
  title: document.getElementById("day-title")?.textContent,
  taskRows: document.querySelectorAll("#task-list .task-row").length,
  followupRows: document.querySelectorAll("#followup-list .task-row").length,
  progress: document.getElementById("progress-text")?.textContent,
  checkin: document.getElementById("checkin-btn")?.textContent,
  heatmapCells: document.querySelectorAll("#heatmap .day-cell").length,
  hasData: !!localStorage.getItem("trace:v1"),
  activeView: document.body.dataset.page
}));

await page.fill("#task-input", "冒烟测试任务 23:59");
await page.press("#task-input", "Enter");
await page.waitForTimeout(250);
const afterAdd = await page.evaluate(() => document.querySelectorAll("#task-list .task-row").length);

await page.click("#checkin-btn");
await page.waitForTimeout(250);
const afterCheckin = await page.evaluate(() => ({
  label: document.getElementById("checkin-btn").textContent,
  stamped: document.getElementById("checkin-btn").classList.contains("stamped")
}));

await page.screenshot({ path: out + "prototype-today.png" });

await page.click('a[href="#heatmap"]');
await page.waitForTimeout(400);
const heatmap = await page.evaluate(() => ({
  cells: document.querySelectorAll("#heatmap .day-cell").length,
  colored: document.querySelectorAll("#heatmap .day-cell.lv-1, #heatmap .day-cell.lv-2, #heatmap .day-cell.lv-3, #heatmap .day-cell.lv-4, #heatmap .day-cell.lv-5").length,
  title: document.getElementById("day-title") ? null : document.getElementById("hm-day-title")?.textContent
}));
await page.screenshot({ path: out + "prototype-heatmap.png" });

await page.click('a[href="#today"]');
await page.waitForTimeout(250);
const states = await page.evaluate(() => {
  const row = document.querySelector("#task-list .task-row");
  const grid = row ? getComputedStyle(row).gridTemplateColumns : "none";
  const chips = Array.from(document.querySelectorAll("#task-list .deadline-chip")).map((c) => c.className + ":" + c.textContent);
  const check = document.querySelector("#task-list .task-check");
  check.click();
  return { grid, chips };
});
await page.waitForTimeout(500);
const doneState = await page.evaluate(() => {
  const first = document.querySelector("#task-list .task-row");
  return {
    rowDone: first.classList.contains("done"),
    checkDone: first.querySelector(".task-check").classList.contains("done"),
    progress: document.getElementById("progress-text").textContent
  };
});

await page.click("#theme-toggle");
await page.waitForTimeout(200);
const theme = await page.evaluate(() => document.documentElement.dataset.theme);
await page.screenshot({ path: out + "prototype-dark.png" });

await page.click('a[href="#settings"]');
await page.waitForTimeout(300);
await page.selectOption("#theme-select", "modern");
await page.waitForTimeout(300);
const modernStyle = await page.evaluate(() => document.documentElement.dataset.theme);
await page.click('a[href="#today"]');
await page.waitForTimeout(300);
await page.screenshot({ path: out + "prototype-modern.png" });

console.log(JSON.stringify({ info, afterAdd, afterCheckin, heatmap, states, doneState, theme, modernStyle, errors }, null, 2));
await browser.close();
