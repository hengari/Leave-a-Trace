"use strict";

const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require("electron");
const path = require("path");
const fs = require("fs");

const DEFAULT_LIBRARY_ROOT = path.join(app.getPath("documents"), "留痕资料库");
const CFG_FILE = () => path.join(app.getPath("userData"), "library-root.json");
let libraryRoot = DEFAULT_LIBRARY_ROOT;

try {
  if (fs.existsSync(CFG_FILE())) {
    const cfg = JSON.parse(fs.readFileSync(CFG_FILE(), "utf8"));
    if (cfg.root) libraryRoot = cfg.root;
  }
} catch (e) { /* 忽略配置损坏 */ }

function saveLibraryCfg() {
  try {
    fs.mkdirSync(path.dirname(CFG_FILE()), { recursive: true });
    fs.writeFileSync(CFG_FILE(), JSON.stringify({ root: libraryRoot }, null, 2));
  } catch (e) { /* 忽略 */ }
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

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/* ---- IPC：资料库 ---- */
ipcMain.handle("library:getRoot", () => libraryRoot);

ipcMain.handle("library:setRoot", async () => {
  const res = await dialog.showOpenDialog({
    title: "选择留痕资料库文件夹",
    properties: ["openDirectory", "createDirectory"]
  });
  if (res.canceled || !res.filePaths[0]) return null;
  libraryRoot = res.filePaths[0];
  saveLibraryCfg();
  return libraryRoot;
});

/* ---- IPC：附件落盘 ---- */
ipcMain.handle("file:saveAttachment", async (e, payload) => {
  const { name, dataUrl, subPath } = payload || {};
  if (!name || !dataUrl) return { ok: false, error: "参数不完整" };
  try {
    const dir = path.join(libraryRoot, String(subPath || "attachments"));
    fs.mkdirSync(dir, { recursive: true });
    const safeName = String(name).replace(/[\\/:*?"<>|]/g, "_");
    const full = path.join(dir, safeName);
    const base64 = String(dataUrl).split(",")[1] || "";
    fs.writeFileSync(full, Buffer.from(base64, "base64"));
    return { ok: true, path: full };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

/* ---- IPC：打开 / 定位 ---- */
ipcMain.handle("file:openPath", (e, p) => {
  if (p && fs.existsSync(p)) { shell.openPath(p); return true; }
  return false;
});

ipcMain.handle("file:showInFolder", (e, p) => {
  if (p && fs.existsSync(p)) { shell.showItemInFolder(p); return true; }
  return false;
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
