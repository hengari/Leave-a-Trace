#!/usr/bin/env node
"use strict";

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "src", "web");
const out = here + "/";
const url = "file:///" + root.replace(/\\/g, "/") + "/index.html";
const cr = createRequire("C:/Users/liuheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const { chromium } = cr("playwright");
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" });
const page = await browser.newPage({ viewport: { width: 1744, height: 890 }, deviceScaleFactor: 1 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await sleep(1200);
await page.click('a[href="#workbench"]');
await sleep(500);
await page.click('.wb-nav-item[data-wb="settings"]');
await sleep(500);
await page.screenshot({ path: out + "settings-before.png", fullPage: false });
/* 量一下各面板与按钮行布局 */
const layout = await page.evaluate(() => {
  const panels = Array.from(document.querySelectorAll("#wb-settings .wb-panel")).map((p) => ({
    title: (p.querySelector("h2") || {}).textContent,
    w: p.offsetWidth,
    x: p.offsetLeft
  }));
  const rows = Array.from(document.querySelectorAll("#wb-settings .wb-actions-row")).map((row, ri) => {
    const btns = Array.from(row.querySelectorAll("button")).map((b) => ({
      text: b.textContent.trim(), w: b.offsetWidth, x: b.offsetLeft, y: b.offsetTop
    }));
    return { row: ri, rowW: row.offsetWidth, btns, sameRow: new Set(btns.map((b) => b.y)).size === 1 };
  });
  return { panels, rows };
});
console.log(JSON.stringify(layout, null, 2));
await browser.close();
