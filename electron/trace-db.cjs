"use strict";

/* ============================================================
 * 留痕 · 统一数据库层（Web 后端 serve.mjs 与桌面端 Electron 共用）
 * SQLite（node:sqlite，需 Node >= 22.13）+ 文件落盘
 * ============================================================ */
const { DatabaseSync } = require("node:sqlite");
const { mkdir, rm, writeFile } = require("node:fs/promises");
const { extname, join } = require("node:path");
const crypto = require("node:crypto");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip"
};

function sanitizeName(name) {
  return String(name || "unnamed").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 200) || "unnamed";
}

function extOf(name) {
  return extname(String(name)).replace(/^\./, "").toLowerCase() || "bin";
}

function mimeOf(ext) {
  return MIME["." + ext] || "application/octet-stream";
}

function publicRow(row) {
  let tags = [];
  try { tags = JSON.parse(row.tags || "[]"); } catch (err) { tags = []; }
  return {
    id: row.id,
    name: row.name,
    ext: row.ext,
    mime: row.mime,
    size: row.size,
    date: row.date,
    tags,
    importedAt: row.imported_at
  };
}

async function openTraceDb(dataRoot) {
  const filesRoot = join(dataRoot, "files");
  await mkdir(filesRoot, { recursive: true });

  const db = new DatabaseSync(join(dataRoot, "trace.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ext TEXT NOT NULL DEFAULT 'bin',
      mime TEXT NOT NULL DEFAULT 'application/octet-stream',
      size INTEGER NOT NULL DEFAULT 0,
      date TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      imported_at TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const stmtGetState = db.prepare("SELECT data FROM app_state WHERE id = 1");
  const stmtPutState = db.prepare(`
    INSERT INTO app_state (id, data, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `);
  const stmtGetFile = db.prepare("SELECT * FROM files WHERE id = ?");
  const stmtListFiles = db.prepare("SELECT id, name, ext, mime, size, date, tags, imported_at FROM files ORDER BY imported_at DESC");
  const stmtInsertFile = db.prepare(`
    INSERT INTO files (id, name, ext, mime, size, date, tags, imported_at, storage_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const stmtDeleteFile = db.prepare("DELETE FROM files WHERE id = ?");

  return {
    dataRoot,
    filesRoot,
    db,

    getState() {
      const row = stmtGetState.get();
      if (!row) return null;
      try { return JSON.parse(row.data); } catch (err) { return null; }
    },

    putState(data) {
      const updatedAt = new Date().toISOString();
      stmtPutState.run(JSON.stringify(data), updatedAt);
      return updatedAt;
    },

    listFiles() {
      return stmtListFiles.all().map(publicRow);
    },

    async insertFile({ name, date, tags, importedAt, buffer }) {
      const safeName = sanitizeName(name);
      const id = crypto.randomUUID();
      const dir = join(filesRoot, id);
      const storagePath = join(dir, safeName);
      await mkdir(dir, { recursive: true });
      await writeFile(storagePath, buffer);
      const ext = extOf(safeName);
      const mime = mimeOf(ext);
      const tagList = Array.isArray(tags) ? tags.filter((t) => typeof t === "string").slice(0, 50) : [];
      stmtInsertFile.run(
        id, safeName, ext, mime, buffer.length,
        String(date || new Date().toISOString().slice(0, 10)),
        JSON.stringify(tagList),
        String(importedAt || new Date().toISOString()),
        storagePath,
        new Date().toISOString()
      );
      return { id, name: safeName, ext, mime, size: buffer.length, date, tags: tagList, importedAt };
    },

    getFile(id) {
      return stmtGetFile.get(id) || null;
    },

    async deleteFile(id) {
      const row = stmtGetFile.get(id);
      if (!row) return false;
      stmtDeleteFile.run(id);
      try { await rm(join(filesRoot, id), { recursive: true, force: true }); } catch (err) { /* 磁盘清理失败不阻塞 */ }
      return true;
    }
  };
}

module.exports = { openTraceDb, MIME };
