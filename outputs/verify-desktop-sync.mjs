/* 桌面版同步验证：截止弹窗（确定+渐变区间）/ 整行点击 / 跨天任务 / 任务完成按钮 / 主题适配 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const WEB = "E:/Leave-a-Trace-main/Leave-a-Trace-main/src/web";
const STATIC_PORT = 8902;
const DEBUG_PORT = 9225;
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const OUT_DIR = "E:/Leave-a-Trace-main/Leave-a-Trace-main/outputs";
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

let failures = 0;
function check(name, ok, extra) {
  console.log((ok ? "PASS" : "FAIL") + " | " + name + (extra ? " | " + extra : ""));
  if (!ok) failures += 1;
}

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const file = path.join(WEB, p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("404"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "text/plain" });
    res.end(data);
  });
}).listen(STATIC_PORT);

const profile = path.join(os.tmpdir(), "trace-verify-desktop-" + Date.now());
const edge = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=" + DEBUG_PORT, "--user-data-dir=" + profile, "about:blank"
], { stdio: "ignore" });

let ws, msgId = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m)));
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) throw new Error("JS 异常: " + JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
}
async function screenshot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.result.data, "base64"));
  console.log("shot | " + name);
}
const lum = (c) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || "");
  return m ? 0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3] : 0;
};
const rgbOf = (c) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || "");
  return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
};

try {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/version"); if (r.ok) break; } catch (err) {}
    await new Promise((r) => setTimeout(r, 400));
  }
  const newResp = await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/new?http://127.0.0.1:" + STATIC_PORT + "/", { method: "PUT" });
  const tab = await newResp.json();
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await send("Page.enable");
  await send("Runtime.enable");

  for (let i = 0; i < 40; i++) {
    const ready = await evalJs("document.querySelectorAll('#task-list .task-row').length");
    if (ready > 0) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  const rows = await evalJs("document.querySelectorAll('#task-list .task-row').length");
  check("页面加载，任务列表渲染", rows > 0, "rows=" + rows);

  /* 整行点击完成任务 */
  const doneClick = await evalJs(`(() => {
    const row = [...document.querySelectorAll('#task-list .task-row')].find(r => r.querySelector('.task-text').textContent === '整理本周报表');
    if (!row) return 'not-found';
    row.click();
    const st = JSON.parse(localStorage.getItem('trace:v1'));
    const t = Object.values(st.days).flatMap(d => d.tasks || []).find(x => x.text === '整理本周报表');
    return t ? t.status : 'missing';
  })()`);
  check("整行点击可完成任务", doneClick === "done", String(doneClick));

  /* 截止弹窗 + 确定按钮 */
  const modalOpen = await evalJs(`(() => {
    const row = [...document.querySelectorAll('#task-list .task-row')].find(r => r.querySelector('.task-text').textContent === '编写留痕项目方案');
    if (!row) return 'not-found';
    row.querySelector('.deadline-chip').click();
    const modal = document.getElementById('deadline-modal');
    return {
      visible: modal && !modal.classList.contains('hidden'),
      hasOk: !!document.getElementById('dl-ok'),
      hasCancel: !!document.getElementById('dl-cancel'),
      hasClear: !!document.getElementById('dl-clear'),
      calTitle: document.getElementById('dl-cal-title') ? document.getElementById('dl-cal-title').textContent : ''
    };
  })()`);
  check("截止弹窗打开且有确定按钮", modalOpen.visible && modalOpen.hasOk && modalOpen.hasCancel && modalOpen.hasClear,
    JSON.stringify(modalOpen));

  /* 渐变区间 + 主题适配 */
  const tones = await evalJs(`(() => {
    const pick = (d) => { const b = document.querySelector('.dl-day[data-date="2026-08-' + d + '"]'); if (b) b.click(); };
    pick('10'); pick('14');
    const bg = (d) => { const b = document.querySelector('.dl-day[data-date="2026-08-' + d + '"]'); return b ? getComputedStyle(b).backgroundColor : null; };
    return { start: bg('07'), mid: bg('10'), end: bg('14') };
  })()`);
  const startLum = lum(tones.start), endLum = lum(tones.end), midLum = lum(tones.mid);
  const startRgb = rgbOf(tones.start), endRgb = rgbOf(tones.end);
  check("渐变颜色：两端深、中间浅", startLum < midLum && endLum < midLum, JSON.stringify(tones));
  check("默认主题渐变为暖色调", startRgb[0] > startRgb[2] && endRgb[0] > endRgb[2], "start=" + tones.start);
  await screenshot("verify-desktop-modal.png");

  /* 确定保存 + 跨天出现 */
  const applied = await evalJs(`(() => {
    document.getElementById('dl-ok').click();
    const st = JSON.parse(localStorage.getItem('trace:v1'));
    const t = Object.values(st.days).flatMap(d => d.tasks || []).find(x => x.text === '编写留痕项目方案');
    return { startDate: t.startDate, deadline: t.deadline };
  })()`);
  check("确定后保存区间截止时间",
    applied.startDate === "2026-08-07" && applied.deadline && applied.deadline.startsWith("2026-08-14"),
    JSON.stringify(applied));

  await evalJs("document.getElementById('next-day').click()");
  const nextDay = await evalJs(`(() => {
    const found = [...document.querySelectorAll('#task-list .task-row')].some(r => r.querySelector('.task-text').textContent === '编写留痕项目方案');
    return { day: document.getElementById('day-title').textContent, found: found };
  })()`);
  check("区间内次日任务出现", nextDay.found && /8月8日/.test(nextDay.day), JSON.stringify(nextDay));

  /* 深色主题冷色调 */
  const darkTone = await evalJs(`(() => {
    const row = [...document.querySelectorAll('#task-list .task-row')].find(r => r.querySelector('.task-text').textContent === '编写留痕项目方案');
    row.querySelector('.deadline-chip').click();
    document.getElementById('dl-start-date').value = '2026-08-07';
    document.getElementById('dl-end-date').value = '2026-08-14';
    renderDeadlineCalendar();
    const sel = document.getElementById('theme-select');
    sel.value = 'dark';
    sel.dispatchEvent(new Event('change'));
    renderDeadlineCalendar();
    const b = document.querySelector('.dl-day[data-date="2026-08-07"]');
    const c = getComputedStyle(b).backgroundColor;
    document.getElementById('dl-cancel').click();
    const sel2 = document.getElementById('theme-select');
    sel2.value = 'paper';
    sel2.dispatchEvent(new Event('change'));
    return c;
  })()`);
  const darkRgb = rgbOf(darkTone);
  check("深色主题渐变改为冷色调", darkRgb[2] > darkRgb[0], "dark start=" + darkTone);

  /* 任务完成按钮：今天辛苦啦 + 动画 + 误触恢复 */
  await evalJs("document.getElementById('today-btn').click()");
  const initialLabel = await evalJs("document.getElementById('checkin-btn').textContent.trim()");
  check("按钮初始为任务完成", initialLabel === "任务完成", initialLabel);
  const clicked = await evalJs(`(() => {
    document.getElementById('checkin-btn').click();
    const st = JSON.parse(localStorage.getItem('trace:v1'));
    const now = new Date();
    const ds = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    return {
      label: document.getElementById('checkin-btn').textContent.trim(),
      checked: document.getElementById('checkin-btn').classList.contains('checked'),
      state: st.days[ds] ? st.days[ds].checkIn : null,
      canvas: !!document.querySelector('.confetti-canvas')
    };
  })()`);
  check("点击后今天辛苦啦并触发动画", clicked.label === "今天辛苦啦 ✓" && clicked.checked && clicked.state && clicked.state.checked && clicked.canvas,
    JSON.stringify(clicked));
  await screenshot("verify-desktop-celebrate.png");
  await new Promise((r) => setTimeout(r, 3500));
  const reverted = await evalJs(`(() => {
    document.getElementById('checkin-btn').click();
    const st = JSON.parse(localStorage.getItem('trace:v1'));
    const now = new Date();
    const ds = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    return {
      label: document.getElementById('checkin-btn').textContent.trim(),
      state: st.days[ds] ? st.days[ds].checkIn : null,
      canvasGone: !document.querySelector('.confetti-canvas')
    };
  })()`);
  check("再次点击恢复原状", reverted.label === "任务完成" && reverted.state === null && reverted.canvasGone,
    JSON.stringify(reverted));

  /* 月度完成天数文案 */
  await evalJs("location.hash = '#monthly'");
  for (let i = 0; i < 20; i++) {
    const has = await evalJs("!!document.querySelector('#monthly-metrics') && document.querySelector('#monthly-metrics').children.length");
    if (has > 0) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const monthlyLabel = await evalJs("Array.from(document.querySelectorAll('#monthly-metrics .label')).map(e => e.textContent).join(',')");
  check("月度统计显示完成天数", monthlyLabel.includes("完成天数"), monthlyLabel);

  /* 工作台入口仍在（桌面独有功能未被破坏） */
  const workbench = await evalJs("typeof renderWorkbench === 'function'");
  check("工作台功能仍存在", workbench);
} catch (err) {
  console.log("ERROR | " + err.stack);
  failures += 1;
} finally {
  try { if (ws) ws.close(); } catch (err) {}
  edge.kill();
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (err) {} }, 500);
  console.log(failures === 0 ? "ALL PASS" : failures + " FAILURE(S)");
  process.exit(failures === 0 ? 0 : 1);
}
