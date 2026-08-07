"use strict";

const { app, BrowserWindow, ipcMain, dialog, Notification } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { openTraceDb } = require("./trace-db.cjs");

let traceDb = null;

function dataRoot() {
  if (process.env.TRACE_DATA_DIR) return path.resolve(process.env.TRACE_DATA_DIR);
  /* 开发运行（npm start）：与 Web 后端共用项目 data/；打包后：用户数据目录 */
  return app.isPackaged
    ? path.join(app.getPath("userData"), "data")
    : path.join(app.getAppPath(), "data");
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    title: "留痕 · Leave a Trace",
    autoHideMenuBar: true,
    backgroundColor: "#f4f1ea",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, "..", "src", "web", "index.html"));
  return win;
}

/* ---------- 冒烟测试模式（TRACE_SMOKE=1，隐藏窗口跑一遍核心链路） ---------- */
function runSmoke() {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, "..", "src", "web", "index.html")).then(async () => {
    let result = null;
    try {
      await new Promise((r) => setTimeout(r, 4000));
      result = await win.webContents.executeJavaScript(`(async () => {
        const out = { desktop: false, localRaw: null, snapshot: null, state: null, putBack: false, upload: null, raw: false, del: null };
        out.desktop = !!(window.traceDesktop && window.traceDesktop.isDesktop);
        try { out.localRaw = localStorage.getItem("trace:v1"); } catch (err) {}
        try { out.snapshot = localStorage.getItem("trace:snapshot"); } catch (err) {}
        try { out.state = await window.traceDesktop.getState(); } catch (err) { out.stateError = String(err); }
        try {
          const probe = {
            meta: { version: 1, recordCount: 0, updatedAt: new Date().toISOString() },
            days: { "2026-08-07": { tasks: [{ id: "p1", text: "probe", status: "pending", order: 0 }], checkIn: null } },
            files: [], monthlyReports: [], settings: {}
          };
          const put = await window.traceDesktop.putState(probe);
          const back = await window.traceDesktop.getState();
          out.putBack = !!(put && put.ok) && !!(back && back.days && back.days["2026-08-07"]);
        } catch (err) { out.putError = String(err); }
        try {
          const up = await window.traceDesktop.uploadFile({
            name: "smoke-\u6d4b\u8bd5.txt",
            dataUrl: "data:text/plain;base64," + btoa("hello smoke"),
            date: "2026-08-07",
            tags: ["smoke"],
            importedAt: new Date().toISOString()
          });
          out.upload = up;
          if (up && up.ok && up.id) {
            const raw = await window.traceDesktop.getFileDataUrl(up.id);
            out.raw = !!(raw && raw.ok && raw.dataUrl);
            out.del = await window.traceDesktop.deleteFile(up.id);
          }
        } catch (err) { out.opError = String(err); }
        return out;
      })()`);
    } catch (err) {
      result = { fatal: String(err) };
    }
    const expectState = !!(result.state && result.state.meta && typeof result.state.days === "object");
    const expectPut = result.putBack === true;
    const expectDesktop = result.desktop === true;
    const expectUpload = !!(result.upload && result.upload.ok);
    const expectRaw = result.raw === true;
    const expectDel = !!(result.del && result.del.ok);
    const summary = {
      ok: expectDesktop && expectPut && expectUpload && expectRaw && expectDel,
      dataRoot: traceDb.dataRoot,
      isPackaged: app.isPackaged,
      expectDesktop, expectState, expectPut, expectUpload, expectRaw, expectDel, detail: result
    };
    console.log("SMOKE_RESULT " + JSON.stringify(summary));
    const outPath = process.env.TRACE_SMOKE_OUT || path.join(os.tmpdir(), "trace-smoke-result.json");
    try { fs.writeFileSync(outPath, JSON.stringify(summary, null, 2)); } catch (err) { /* 结果文件写入失败不阻塞 */ }
    app.exit(expectDesktop && expectPut && expectUpload && expectRaw && expectDel ? 0 : 1);
  }).catch((err) => {
    console.log("SMOKE_LOAD_ERROR " + String(err));
    app.exit(1);
  });
}

app.whenReady().then(async () => {
  traceDb = await openTraceDb(dataRoot());
  console.log("trace-db ready at " + traceDb.dataRoot);
  if (process.env.TRACE_SMOKE === "1") {
    runSmoke();
    return;
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/* ---- IPC：状态 ---- */
ipcMain.handle("db:getState", () => {
  try { return traceDb.getState(); } catch (err) { return null; }
});

ipcMain.handle("db:putState", (e, data) => {
  if (!data || typeof data !== "object" || !data.meta || !data.days) {
    return { ok: false, error: "state 格式不正确" };
  }
  try {
    traceDb.putState(data);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

/* ---- IPC：文件（统一落 data/files/） ---- */
ipcMain.handle("file:upload", async (e, payload) => {
  const { name, dataUrl, date, tags, importedAt } = payload || {};
  if (!name || !dataUrl) return { ok: false, error: "参数不完整" };
  try {
    const buffer = Buffer.from(String(dataUrl).split(",")[1] || "", "base64");
    const rec = await traceDb.insertFile({
      name,
      date: String(date || new Date().toISOString().slice(0, 10)),
      tags: Array.isArray(tags) ? tags : [],
      importedAt: String(importedAt || new Date().toISOString()),
      buffer
    });
    return { ok: true, ...rec };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle("file:getDataUrl", (e, id) => {
  try {
    const row = traceDb.getFile(id);
    if (!row || !fs.existsSync(row.storage_path)) return { ok: false, error: "文件不存在" };
    const buf = fs.readFileSync(row.storage_path);
    return {
      ok: true,
      name: row.name,
      mime: row.mime,
      size: row.size,
      dataUrl: "data:" + (row.mime || "application/octet-stream") + ";base64," + buf.toString("base64")
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle("file:delete", async (e, id) => {
  try {
    const ok = await traceDb.deleteFile(id);
    return { ok };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

/* ---- IPC：月报导出 PDF ---- */
ipcMain.handle("print:pdf", async (e, payload) => {
  const html = payload && payload.html ? payload.html : "";
  const defaultName = payload && payload.defaultName ? payload.defaultName : "月度汇总.pdf";
  if (!html) return { ok: false, error: "缺少 HTML" };
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, offscreen: false }
  });
  try {
    await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    const pdf = await win.webContents.printToPDF({ pageSize: "A4", printBackground: true, margins: { marginType: "default" } });
    const res = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: "PDF", extensions: ["pdf"] }]
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(res.filePath, pdf);
    return { ok: true, path: res.filePath };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    win.destroy();
  }
});

/* ---- IPC：桌面通知 ---- */
ipcMain.handle("notify", (e, payload) => {
  if (Notification.isSupported()) {
    new Notification({
      title: (payload && payload.title) || "留痕",
      body: (payload && payload.body) || ""
    }).show();
  }
  return true;
});
