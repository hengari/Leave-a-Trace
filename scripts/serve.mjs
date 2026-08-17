#!/usr/bin/env node
"use strict";

/* ============================================================
 * 留痕 · Leave a Trace —— 本地/局域网后端服务
 * 静态站点 + REST API + SQLite 数据库 + 文件落盘存储
 * 零外部依赖（需要 Node >= 22.5，使用内置 node:sqlite）
 * 数据库层与桌面端共用：electron/trace-db.cjs
 * ============================================================ */
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import traceDbMod from "../electron/trace-db.cjs";
import webdavSyncMod from "./webdav-sync.cjs";

const { openTraceDb, MIME } = traceDbMod;
const { syncOnce } = webdavSyncMod;

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const webRoot = resolve(projectRoot, "src", "web");

/* 数据目录：与桌面端共用同一 SQLite（网页 ⇄ 桌面实时同步）。
   优先级：--data-dir 参数 > TRACE_DATA_DIR 环境变量
   > Windows 桌面端用户数据（%APPDATA%\留痕\data）> 项目 data/ */
function defaultDataRoot() {
  if (process.env.TRACE_DATA_DIR) return resolve(process.env.TRACE_DATA_DIR);
  if (process.platform === "win32" && process.env.APPDATA) {
    return join(process.env.APPDATA, "留痕", "data");
  }
  return resolve(projectRoot, "data");
}
const argIdx = process.argv.indexOf("--data-dir");
const dataRoot = resolve(argIdx > -1 ? process.argv[argIdx + 1] : defaultDataRoot());

const defaultPort = 8787;
const port = Number(process.argv[process.argv.indexOf("--port") + 1] || process.env.PORT || defaultPort);

const MAX_STATE_BYTES = 200 * 1024 * 1024;
const MAX_FILE_BYTES = 500 * 1024 * 1024;

const traceDb = await openTraceDb(dataRoot);

/* ---------- 云端同步（WebDAV，坚果云等） ---------- */
function loadSyncConfig() {
  try {
    const raw = readFileSync(resolve(projectRoot, "sync-config.json"), "utf8");
    const cfg = JSON.parse(raw);
    if (cfg && cfg.enabled === false) return null;
    return cfg && cfg.url && cfg.username ? cfg : null;
  } catch {
    return null;
  }
}
const syncConfig = loadSyncConfig();

let syncTimer = null;
let syncRunning = false;
async function runSync(reason) {
  if (!syncConfig || syncRunning) return;
  syncRunning = true;
  try {
    await syncOnce(syncConfig, {
      getState: () => traceDb.getState(),
      putState: (s) => traceDb.putState(s),
      log: (msg) => console.log(msg + (reason ? "（" + reason + "）" : ""))
    });
  } catch (err) {
    console.log("[sync] 失败: " + (err && err.message || err) + (reason ? "（" + reason + "）" : ""));
  } finally {
    syncRunning = false;
  }
}
function scheduleSync(reason, delay = 3000) {
  if (!syncConfig) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => runSync(reason), delay);
}

/* ---------- 工具 ---------- */
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function safeId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

/* 合并状态：按日期/任务 id 取并集（incoming 优先），
   防止网页端与桌面端同时编辑时整表覆盖丢失对方数据。
   注意：网页端删除的任务会保留（避免误删覆盖），桌面端删除仍即时生效 */
function mergeState(existing, incoming) {
  if (!existing) return incoming;
  const days = {};
  const allDates = new Set([...Object.keys(existing.days || {}), ...Object.keys(incoming.days || {})]);
  for (const date of allDates) {
    const ex = (existing.days && existing.days[date]) || null;
    const inc = (incoming.days && incoming.days[date]) || null;
    if (!inc) { days[date] = ex; continue; }
    if (!ex) { days[date] = inc; continue; }
    const tasks = {};
    for (const t of (ex.tasks || [])) if (t && t.id) tasks[t.id] = t;
    for (const t of (inc.tasks || [])) if (t && t.id) tasks[t.id] = t;
    days[date] = { ...inc, tasks: Object.values(tasks), checkIn: inc.checkIn || ex.checkIn || null };
  }
  const files = {};
  for (const f of (existing.files || [])) if (f && f.id) files[f.id] = f;
  for (const f of (incoming.files || [])) if (f && f.id) files[f.id] = f;
  const reports = {};
  for (const r of (existing.monthlyReports || [])) if (r && (r.id || r.month)) reports[r.id || r.month] = r;
  for (const r of (incoming.monthlyReports || [])) if (r && (r.id || r.month)) reports[r.id || r.month] = r;
  // 墓碑合并：按 id 取 deletedAt 较新者，并应用到 days（删除跨端传播）
  const deleted = {};
  for (const [id, t] of Object.entries(existing.deletedTasks || {})) deleted[id] = t;
  for (const [id, t] of Object.entries(incoming.deletedTasks || {})) {
    if (!deleted[id] || (t.deletedAt || "") > (deleted[id].deletedAt || "")) deleted[id] = t;
  }
  for (const day of Object.values(days)) {
    day.tasks = (day.tasks || []).filter((task) => !deleted[task.id]);
  }
  let count = 0;
  for (const day of Object.values(days)) count += (day.tasks || []).length;
  return {
    meta: {
      version: 1,
      createdAt: incoming.meta.createdAt || (existing.meta && existing.meta.createdAt) || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      recordCount: count,
      nextBackupHintAt: incoming.meta.nextBackupHintAt ?? (existing.meta && existing.meta.nextBackupHintAt) ?? 20
    },
    days,
    files: Object.values(files),
    monthlyReports: Object.values(reports),
    deletedTasks: deleted,
    settings: incoming.settings || existing.settings || {}
  };
}

/* ---------- API：状态 ---------- */
async function apiGetState(req, res) {
  const data = traceDb.getState();
  sendJson(res, 200, { ok: true, data });
}

async function apiPutState(req, res) {
  try {
    const body = await readBody(req, MAX_STATE_BYTES);
    const data = JSON.parse(body.toString("utf8"));
    if (!data || typeof data !== "object" || !data.meta || !data.days) {
      sendJson(res, 400, { ok: false, error: "state 格式不正确（需要 meta 与 days）" });
      return;
    }
    const existing = traceDb.getState();
    const merged = mergeState(existing, data);
    const updatedAt = traceDb.putState(merged);
    scheduleSync("状态变更");
    sendJson(res, 200, { ok: true, updatedAt });
  } catch (err) {
    if (err && err.message === "payload too large") {
      sendJson(res, 413, { ok: false, error: "state 过大" });
      return;
    }
    sendJson(res, 400, { ok: false, error: "JSON 解析失败：" + String(err && err.message || err) });
  }
}

/* ---------- API：文件 ---------- */
async function apiUploadFile(req, res, url) {
  try {
    const body = await readBody(req, MAX_FILE_BYTES);
    const name = String(url.searchParams.get("name") || "");
    const date = String(url.searchParams.get("date") || new Date().toISOString().slice(0, 10));
    const importedAt = String(url.searchParams.get("importedAt") || new Date().toISOString());
    let tags = [];
    try { tags = JSON.parse(url.searchParams.get("tags") || "[]"); } catch (err) { tags = []; }
    const rec = await traceDb.insertFile({ name, date, tags, importedAt, buffer: body });
    sendJson(res, 200, { ok: true, ...rec });
  } catch (err) {
    if (err && err.message === "payload too large") {
      sendJson(res, 413, { ok: false, error: "文件过大（上限 500MB）" });
      return;
    }
    sendJson(res, 500, { ok: false, error: "上传失败：" + String(err && err.message || err) });
  }
}

function apiGetFile(req, res, id, inline) {
  const row = traceDb.getFile(id);
  if (!row) { sendJson(res, 404, { ok: false, error: "文件不存在" }); return; }
  if (!existsSync(row.storage_path)) { sendJson(res, 410, { ok: false, error: "文件本体已丢失" }); return; }
  const headers = {
    "Content-Type": row.mime || "application/octet-stream",
    "Content-Length": row.size,
    "Cache-Control": "no-store"
  };
  if (!inline) {
    headers["Content-Disposition"] = "attachment; filename*=UTF-8''" + encodeURIComponent(row.name);
  }
  res.writeHead(200, headers);
  createReadStream(row.storage_path).pipe(res);
}

async function apiDeleteFile(req, res, id) {
  const ok = await traceDb.deleteFile(id);
  if (!ok) { sendJson(res, 404, { ok: false, error: "文件不存在" }); return; }
  sendJson(res, 200, { ok: true });
}

/* ---------- 静态站点 ---------- */
async function serveStatic(req, res, urlPath) {
  try {
    let filePath = resolve(webRoot, "." + (urlPath === "/" ? "/index.html" : urlPath));
    if (filePath !== webRoot && !filePath.startsWith(webRoot + sep)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("403 Forbidden");
      return;
    }
    let info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = resolve(filePath, "index.html");
      info = await stat(filePath);
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 Not Found");
  }
}

/* ---------- 路由 ---------- */
async function route(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  if (req.method === "GET" && path === "/api/health") {
    sendJson(res, 200, { ok: true, service: "trace-backend", port, db: join(traceDb.dataRoot, "trace.db") });
    return;
  }

  if (path === "/api/state") {
    if (req.method === "GET") { apiGetState(req, res); return; }
    if (req.method === "PUT") { apiPutState(req, res); return; }
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }

  if (path === "/api/backup" && req.method === "POST") {
    try {
      const state = traceDb.getState();
      if (!state) { sendJson(res, 400, { ok: false, error: "无数据可备份" }); return; }
      const backupsDir = join(traceDb.dataRoot, "backups");
      mkdirSync(backupsDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      const file = join(backupsDir, "留痕-备份-" + stamp + ".json");
      writeFileSync(file, JSON.stringify(state, null, 2), "utf8");
      sendJson(res, 200, { ok: true, file });
      return;
    } catch (err) {
      sendJson(res, 500, { ok: false, error: String(err && err.message || err) });
      return;
    }
  }

  if (path === "/api/files") {
    if (req.method === "POST") { apiUploadFile(req, res, url); return; }
    if (req.method === "GET") {
      sendJson(res, 200, { ok: true, files: traceDb.listFiles() });
      return;
    }
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }

  const fileMatch = path.match(/^\/api\/files\/([A-Za-z0-9_-]{1,64})(\/raw)?$/);
  if (fileMatch) {
    const id = safeId(fileMatch[1]);
    if (req.method === "GET") { apiGetFile(req, res, id, !!fileMatch[2]); return; }
    if (req.method === "DELETE" && !fileMatch[2]) { apiDeleteFile(req, res, id); return; }
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }

  if (path.startsWith("/api/")) {
    sendJson(res, 404, { ok: false, error: "接口不存在" });
    return;
  }

  serveStatic(req, res, path);
}

function lanAddress() {
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === "IPv4" && !info.internal) return info.address;
    }
  }
  return null;
}

const server = createServer((req, res) => {
  route(req, res).catch((err) => {
    try { sendJson(res, 500, { ok: false, error: String(err && err.message || err) }); } catch (err2) { res.destroy(); }
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`留痕后端已启动：http://127.0.0.1:${port}/`);
  const lan = lanAddress();
  if (lan) console.log(`局域网访问：http://${lan}:${port}/`);
  console.log(`数据库：${join(traceDb.dataRoot, "trace.db")}`);
  console.log(`文件存储：${traceDb.filesRoot}`);
  console.log(`静态目录：${webRoot}`);
  if (syncConfig) {
    console.log(`云端同步：已启用 → ${syncConfig.url}`);
    setTimeout(() => runSync("启动"), 1500);
    setInterval(() => runSync("定时"), 60000);
  } else {
    console.log("云端同步：未配置（跨设备同步请参照 sync-config.example.json 填写 sync-config.json）");
  }
});
