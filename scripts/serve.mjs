#!/usr/bin/env node
"use strict";

/* ============================================================
 * 留痕 · Leave a Trace —— 本地/局域网后端服务
 * 静态站点 + REST API + SQLite 数据库 + 文件落盘存储
 * 零外部依赖（需要 Node >= 22.5，使用内置 node:sqlite）
 * 数据库层与桌面端共用：electron/trace-db.cjs
 * ============================================================ */
import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import traceDbMod from "../electron/trace-db.cjs";

const { openTraceDb, MIME } = traceDbMod;

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const webRoot = resolve(projectRoot, "src", "web");
const dataRoot = resolve(projectRoot, "data");

const defaultPort = 8787;
const port = Number(process.argv[process.argv.indexOf("--port") + 1] || process.env.PORT || defaultPort);

const MAX_STATE_BYTES = 200 * 1024 * 1024;
const MAX_FILE_BYTES = 500 * 1024 * 1024;

const traceDb = await openTraceDb(dataRoot);

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
    const updatedAt = traceDb.putState(data);
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
});
