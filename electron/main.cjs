"use strict";

const { app, BrowserWindow, ipcMain, dialog, Notification } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { openTraceDb } = require("./trace-db.cjs");
// 自动更新：安全加载——安装包未打包 electron-updater 时跳过，不影响启动
let autoUpdater = null;
try {
  autoUpdater = require("electron-updater").autoUpdater;
} catch (err) { /* 未打包 electron-updater（开发模式/旧安装包），跳过自动更新 */ }

// Windows DirectComposition can corrupt idle transparent always-on-top
// windows after focus changes. Software composition keeps transparency while
// avoiding the stale white tiles produced by the GPU surface.
if (process.platform === "win32") app.disableHardwareAcceleration();

let traceDb = null;
let mainWindow = null;
let floatingWindow = null;
let quitting = false;
let workbenchTasks = [];
let workbenchInitialized = false;
let floatingPrefs = { visible: false, bounds: null };
let floatingMaterial = "css-fallback";
let activeFocusSession = null;

function localDateKey(value) {
  const d = value ? new Date(value) : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function focusElapsedMs(session) {
  if (!session) return 0;
  return Math.max(0, Number(session.accumulatedMs) || 0)
    + (session.paused ? 0 : Math.max(0, Date.now() - Number(session.startedAt || Date.now())));
}

function focusSessionSnapshot() {
  if (!activeFocusSession) return null;
  return Object.assign({}, activeFocusSession, { elapsedMs: focusElapsedMs(activeFocusSession) });
}

function broadcastFocusState() {
  const payload = { active: focusSessionSnapshot() };
  sendToWindows("focus:stateChanged", payload);
  return payload;
}

function focusMessage(seconds) {
  const minutes = seconds / 60;
  if (minutes < 5) return "起步就是胜利";
  if (minutes < 15) return "进入状态了";
  if (minutes < 25) return "渐入佳境";
  if (minutes < 45) return "完成一个番茄钟，漂亮！";
  if (minutes < 60) return "双倍番茄，深度专注";
  return "心流大师，今天状态拉满";
}

function focusMilestone(beforeSeconds, afterSeconds) {
  const milestones = [
    [240 * 60, "四小时，专业选手"],
    [120 * 60, "两小时，了不起"],
    [60 * 60, "今天专注满 1 小时"],
    [30 * 60, "已专注半小时"]
  ];
  const hit = milestones.find(([threshold]) => beforeSeconds < threshold && afterSeconds >= threshold);
  return hit ? hit[1] : "";
}

function floatingPrefsPath() {
  return path.join(traceDb.dataRoot, "floating-window.json");
}

function loadFloatingPrefs() {
  try {
    const parsed = JSON.parse(fs.readFileSync(floatingPrefsPath(), "utf8"));
    floatingPrefs = {
      visible: !!parsed.visible,
      bounds: parsed.bounds && Number.isFinite(parsed.bounds.x) && Number.isFinite(parsed.bounds.y)
        ? parsed.bounds : null
    };
  } catch (err) {
    floatingPrefs = { visible: false, bounds: null };
  }
}

function saveFloatingPrefs() {
  try {
    fs.writeFileSync(floatingPrefsPath(), JSON.stringify(floatingPrefs, null, 2));
  } catch (err) { /* 浮窗偏好保存失败不阻塞主流程 */ }
}

function traceTaskSummaries(data) {
  const out = [];
  const days = data && data.days && typeof data.days === "object" ? data.days : {};
  Object.keys(days).forEach((date) => {
    const tasks = Array.isArray(days[date] && days[date].tasks) ? days[date].tasks : [];
    tasks.forEach((task) => {
      if (!task || !task.id || !task.text) return;
      out.push({
        source: "trace",
        id: String(task.id),
        title: String(task.text),
        category: task.category === "life" ? "life" : "work",
        status: task.status === "done" ? "done" : String(task.status || "pending"),
        completed: task.status === "done",
        date,
        deadline: task.deadline || "",
        dueText: task.deadline || "",
        note: typeof task.note === "string" ? task.note : "",
        focusSeconds: Math.max(0, Number(task.focusSeconds) || 0),
        createdAt: task.createdAt || "",
        updatedAt: task.updatedAt || task.createdAt || ""
      });
    });
  });
  return out;
}

function sanitizeWorkbenchTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks.filter((task) => task && task.id && task.title).map((task) => ({
    source: "workbench",
    id: String(task.id),
    title: String(task.title),
    category: task.category === "life" ? "life" : "work",
    status: String(task.status || "待开始"),
    completed: task.status === "已完成",
    date: "",
    deadline: task.deadline || "",
    dueText: String(task.dueText || ""),
    note: typeof task.note === "string" ? task.note : "",
    focusSeconds: Math.max(0, Number(task.focusSeconds) || 0),
    priority: String(task.priority || "中"),
    projectName: String(task.projectName || "个人待办"),
    createdAt: task.createdAt || "",
    updatedAt: task.updatedAt || task.createdAt || ""
  }));
}

function taskSnapshot() {
  let traceState = null;
  try { traceState = traceDb.getState(); } catch (err) { /* 返回工作台快照 */ }
  const today = localDateKey();
  const todayState = traceState && traceState.days && traceState.days[today];
  return {
    updatedAt: new Date().toISOString(),
    tasks: traceTaskSummaries(traceState).concat(workbenchTasks),
    pomodoroEnabled: !(traceState && traceState.settings && traceState.settings.pomodoroEnabled === false),
    style: traceState && traceState.settings && traceState.settings.style || "paper",
    todayFocusSeconds: Math.max(0, Number(todayState && todayState.focusSeconds) || 0)
  };
}

function sendToWindows(channel, payload) {
  [mainWindow, floatingWindow].forEach((win) => {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  });
}

function setFloatingVisible(visible, inactive) {
  floatingPrefs.visible = !!visible;
  saveFloatingPrefs();
  if (!floatingWindow || floatingWindow.isDestroyed()) return floatingPrefs.visible;
  if (floatingPrefs.visible) {
    if (inactive) floatingWindow.showInactive();
    else {
      floatingWindow.show();
      floatingWindow.focus();
    }
  } else {
    floatingWindow.hide();
  }
  sendToWindows("floating:visibility", { visible: floatingPrefs.visible });
  return floatingPrefs.visible;
}

function broadcastTaskSnapshot(showForNewTask) {
  const snapshot = taskSnapshot();
  sendToWindows("tasks:stateChanged", snapshot);
  if (showForNewTask) setFloatingVisible(true, true);
  return snapshot;
}

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
    // 无边框：顶部标题栏由页面自绘（图四风格圆点 + X 控制按钮）
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: "#f5efe3",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, "..", "src", "web", "index.html"));
  mainWindow = win;
  win.on("closed", () => {
    mainWindow = null;
    if (process.platform !== "darwin" && !quitting) app.quit();
  });
  return win;
}

function createFloatingWindow() {
  const options = {
    width: 372,
    height: 520,
    minWidth: 340,
    minHeight: 420,
    maxWidth: 440,
    title: "浮窗待办 · 留痕",
    show: false,
    frame: false,
    // 透明窗口 + 高不透明度玻璃（0.96）：任何桌面颜色上都呈现
    // 干净浅色，保留轻微透感。不使用 acrylic（无边框窗口边缘
    // 有黑圈 bug）、不使用 backdrop-filter（透明窗口不生效）。
    transparent: true,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    roundedCorners: true,
    thickFrame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Transparent always-on-top windows can be treated as occluded after
      // sitting idle on Windows. Keep this renderer painting so Chromium does
      // not restore a stale/white compositor tile when it becomes active.
      backgroundThrottling: false
    }
  };
  if (floatingPrefs.bounds) {
    options.x = floatingPrefs.bounds.x;
    options.y = floatingPrefs.bounds.y;
    if (Number.isFinite(floatingPrefs.bounds.width)) options.width = floatingPrefs.bounds.width;
    if (Number.isFinite(floatingPrefs.bounds.height)) options.height = floatingPrefs.bounds.height;
  }
  const win = new BrowserWindow(options);
  floatingWindow = win;
  if (process.platform === "win32" && typeof win.setBackgroundMaterial === "function") {
    try {
      win.setBackgroundMaterial("none");
    } catch (err) { /* Older Windows builds do not expose this API. */ }
  }
  floatingMaterial = process.platform === "win32" ? "transparent-software" : "transparent";
  win.setAlwaysOnTop(true, "floating");
  win.loadFile(path.join(__dirname, "..", "src", "web", "floating.html"), {
    query: { surface: "transparent" }
  });
  win.once("ready-to-show", () => {
    if (floatingPrefs.visible) win.showInactive();
  });
  let boundsTimer = null;
  const rememberBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!win.isDestroyed()) {
        floatingPrefs.bounds = win.getBounds();
        saveFloatingPrefs();
      }
    }, 200);
  };
  win.on("move", rememberBounds);
  win.on("resize", rememberBounds);
  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      setFloatingVisible(false, true);
    }
  });
  win.on("closed", () => { floatingWindow = null; });
  return win;
}

async function runVisualQa() {
  const outputDir = path.resolve(process.env.TRACE_VISUAL_QA);
  fs.mkdirSync(outputDir, { recursive: true });
  const rendererErrors = [];
  [mainWindow, floatingWindow].forEach((win) => {
    win.webContents.on("console-message", (event, level, message) => {
      if (level >= 2) rendererErrors.push(message);
    });
  });
  const waitForLoad = (win) => new Promise((resolve) => {
    if (!win.webContents.isLoading()) resolve();
    else win.webContents.once("did-finish-load", resolve);
  });
  await Promise.all([waitForLoad(mainWindow), waitForLoad(floatingWindow)]);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const qaState = traceDb.getState();
  const qaDate = localDateKey();
  if (qaState && qaState.meta && qaState.days) {
    if (!qaState.days[qaDate]) qaState.days[qaDate] = { tasks: [], checkIn: null, focusSeconds: 0 };
    if (process.env.TRACE_FOCUS_QA === "1") {
      qaState.days[qaDate].focusSeconds = 0;
      (qaState.days[qaDate].tasks || []).forEach((task) => {
        task.status = "done";
        task.completedAt = task.completedAt || new Date().toISOString();
      });
    }
    qaState.days[qaDate].tasks = (qaState.days[qaDate].tasks || []).filter((task) => task.id !== "qa-glass-task");
    qaState.days[qaDate].tasks.push({
      id: "qa-glass-task",
      text: process.env.TRACE_VISUAL_QA_TASK_TEXT || "整理晚间阅读计划",
      status: "in_progress",
      createdAt: new Date().toISOString(),
      deadline: new Date(Date.now() + 4 * 3600000).toISOString(),
      completedAt: null,
      tags: [],
      note: "",
      focusSeconds: 0,
      category: "life",
      updatedAt: new Date().toISOString(),
      order: qaState.days[qaDate].tasks.length
    });
    qaState.settings = qaState.settings || {};
    qaState.settings.lastTaskCategory = "life";
    qaState.settings.pomodoroEnabled = true;
    qaState.meta.updatedAt = new Date().toISOString();
    traceDb.putState(qaState);
    broadcastTaskSnapshot(false);
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  await mainWindow.webContents.executeJavaScript('location.hash = "#today"; renderRoute();');
  await floatingWindow.webContents.executeJavaScript('activeFilter = "life"; render();');
  const idleQaMs = Math.max(0, Number(process.env.TRACE_VISUAL_QA_IDLE_MS) || 0);
  if (idleQaMs) {
    floatingWindow.show();
    floatingWindow.focus();
    await new Promise((resolve) => setTimeout(resolve, 250));
    mainWindow.show();
    mainWindow.focus();
    await new Promise((resolve) => setTimeout(resolve, idleQaMs));
  }
  mainWindow.show();
  mainWindow.focus();
  await new Promise((resolve) => setTimeout(resolve, 150));
  const mainImage = await mainWindow.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, "main-category-cards.png"), mainImage.toPNG());
  const floatingImage = await floatingWindow.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, "floating-life-task.png"), floatingImage.toPNG());

  const before = taskSnapshot();
  const target = before.tasks.find((task) => task.source === "trace" && task.id === "qa-glass-task");
  let focusQa = null;
  if (process.env.TRACE_FOCUS_QA === "1" && target) {
    const start = await floatingWindow.webContents.executeJavaScript(
      'window.traceDesktop.focusStart({ source: "trace", taskId: ' + JSON.stringify(target.id) +
      ', title: ' + JSON.stringify(target.title) + ', category: "life" })'
    );
    await new Promise((resolve) => setTimeout(resolve, 1250));
    const activeUi = {
      mainButton: await mainWindow.webContents.executeJavaScript(
        'document.querySelector(' + JSON.stringify('[data-task="' + target.id + '"] .focus-task-btn') + ')?.textContent || ""'
      ),
      floatingPanel: await floatingWindow.webContents.executeJavaScript('!!document.querySelector(".floating-focus-panel")')
    };
    const mainFocusImage = await mainWindow.webContents.capturePage();
    fs.writeFileSync(path.join(outputDir, "main-focus-active.png"), mainFocusImage.toPNG());
    const floatingFocusImage = await floatingWindow.webContents.capturePage();
    fs.writeFileSync(path.join(outputDir, "floating-focus-active.png"), floatingFocusImage.toPNG());

    const paused = await mainWindow.webContents.executeJavaScript('window.traceDesktop.focusPause({ paused: true })');
    const pausedBefore = paused && paused.active && paused.active.elapsedMs;
    await new Promise((resolve) => setTimeout(resolve, 700));
    const pausedState = await floatingWindow.webContents.executeJavaScript('window.traceDesktop.focusGetState()');
    const pausedAfter = pausedState && pausedState.active && pausedState.active.elapsedMs;
    const resumed = await floatingWindow.webContents.executeJavaScript('window.traceDesktop.focusPause({ paused: false })');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const stopped = await floatingWindow.webContents.executeJavaScript('window.traceDesktop.focusStop({ cancel: false })');
    await new Promise((resolve) => setTimeout(resolve, 550));
    const stored = traceDb.getState();
    const storedTask = traceTaskSummaries(stored).find((task) => task.id === target.id);
    const storedDaySeconds = Number(stored.days[qaDate] && stored.days[qaDate].focusSeconds) || 0;
    const mainModalUi = await mainWindow.webContents.executeJavaScript(`(async () => {
      await openFocusModal(findTask(${JSON.stringify(target.id)}));
      await new Promise((resolve) => setTimeout(resolve, 700));
      return {
        visible: !document.querySelector('#focus-modal').classList.contains('hidden'),
        time: document.querySelector('#focus-ring-time').textContent,
        title: document.querySelector('#focus-modal-title').textContent
      };
    })()`);
    mainWindow.show();
    mainWindow.focus();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const mainModalImage = await mainWindow.webContents.capturePage();
    fs.writeFileSync(path.join(outputDir, "main-focus-modal.png"), mainModalImage.toPNG());
    const darkMainUi = await mainWindow.webContents.executeJavaScript(`(() => {
      applyTheme('dark');
      const ring = getComputedStyle(document.querySelector('#focus-ring-progress')).stroke;
      const panel = getComputedStyle(document.querySelector('.focus-modal')).backgroundColor;
      return { theme: document.documentElement.dataset.theme, ring, panel };
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const darkModalImage = await mainWindow.webContents.capturePage();
    fs.writeFileSync(path.join(outputDir, "main-focus-modal-dark.png"), darkModalImage.toPNG());
    await mainWindow.webContents.executeJavaScript('applyTheme("paper")');
    const cancelled = await mainWindow.webContents.executeJavaScript('window.traceDesktop.focusStop({ cancel: true })');
    await new Promise((resolve) => setTimeout(resolve, 350));
    const afterCancel = traceDb.getState();
    const afterCancelTask = traceTaskSummaries(afterCancel).find((task) => task.id === target.id);
    const cancelPreserved = !!(afterCancelTask
      && afterCancelTask.focusSeconds === storedTask.focusSeconds
      && Number(afterCancel.days[qaDate].focusSeconds || 0) === storedDaySeconds);
    const disabledUi = await mainWindow.webContents.executeJavaScript(`(async () => {
      state.settings.pomodoroEnabled = false;
      save(); renderToday();
      await new Promise((resolve) => setTimeout(resolve, 450));
      return document.querySelectorAll('.focus-task-btn').length;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const floatingDisabledUi = await floatingWindow.webContents.executeJavaScript('document.querySelectorAll(".floating-focus-btn").length');
    const monthlyUi = await mainWindow.webContents.executeJavaScript(`(() => {
      state.settings.pomodoroEnabled = true;
      save();
      monthCursor = ${JSON.stringify(qaDate.slice(0, 7))};
      renderMonthly();
      return {
        metric: Array.from(document.querySelectorAll('#monthly-metrics .metric')).some((el) => el.textContent.includes('专注时长')),
        day: !!document.querySelector('.month-day-focus'),
        heat: !!document.querySelector('.hm-cell.has-focus')
      };
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 450));
    await mainWindow.webContents.executeJavaScript('(async () => { state.settings.style = "dark"; await window.traceDesktop.putState(state); })()');
    await new Promise((resolve) => setTimeout(resolve, 350));
    const floatingDarkUi = await floatingWindow.webContents.executeJavaScript(`(() => ({
      theme: document.documentElement.dataset.theme,
      ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(),
      ring: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    }))()`);
    await mainWindow.webContents.executeJavaScript('(async () => { state.settings.style = "paper"; applyTheme("paper"); await window.traceDesktop.putState(state); })()');
    await new Promise((resolve) => setTimeout(resolve, 350));
    focusQa = {
      ok: !!(start && start.ok && activeUi.mainButton.includes("专注中") && activeUi.floatingPanel
        && paused && paused.ok && resumed && resumed.ok && stopped && stopped.ok
        && Math.abs(Number(pausedAfter) - Number(pausedBefore)) < 150
        && storedTask && storedTask.focusSeconds >= stopped.sessionSeconds
        && storedDaySeconds >= stopped.sessionSeconds
        && mainModalUi.visible && mainModalUi.title === target.title
        && darkMainUi.theme === "dark" && darkMainUi.ring && darkMainUi.panel
        && cancelled && cancelled.ok && cancelled.cancelled && cancelPreserved
        && disabledUi === 0 && floatingDisabledUi === 0
        && monthlyUi.metric && monthlyUi.day && monthlyUi.heat
        && floatingDarkUi.theme === "dark" && floatingDarkUi.ink && floatingDarkUi.ring),
      start,
      activeUi,
      pauseStableMs: Math.abs(Number(pausedAfter) - Number(pausedBefore)),
      stopped,
      storedTaskFocusSeconds: storedTask && storedTask.focusSeconds,
      storedDayFocusSeconds: storedDaySeconds,
      mainModalUi,
      darkMainUi,
      cancelPreserved,
      disabledUi: { main: disabledUi, floating: floatingDisabledUi },
      monthlyUi,
      floatingDarkUi
    };
  }
  let completion = { ok: false, error: "未找到玻璃浮窗测试任务" };
  if (target) {
    completion = await floatingWindow.webContents.executeJavaScript(
      'window.traceDesktop.completeTask({ source: "trace", id: ' + JSON.stringify(target.id) + ' })'
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const allDoneUi = process.env.TRACE_FOCUS_QA === "1"
    ? await mainWindow.webContents.executeJavaScript(`(() => ({
        confetti: !!document.querySelector('.confetti-canvas'),
        toast: document.querySelector('#toast').textContent
      }))()`)
    : null;
  const floatingAfter = await floatingWindow.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, "floating-after-complete.png"), floatingAfter.toPNG());
  const after = taskSnapshot();
  const completedTask = target && after.tasks.find((task) => task.source === "trace" && task.id === target.id);
  const report = {
    ok: !!(completion && completion.ok && completedTask && completedTask.completed
      && (!focusQa || (focusQa.ok && allDoneUi && allDoneUi.confetti
        && allDoneUi.toast.includes("今日全部完成")))),
    electronVersion: process.versions.electron,
    windowsRelease: os.release(),
    floatingMaterial,
    completion,
    focusQa,
    allDoneUi,
    targetId: target && target.id,
    mainPendingBefore: before.tasks.filter((task) => !task.completed).length,
    mainPendingAfter: after.tasks.filter((task) => !task.completed).length,
    rendererErrors,
    screenshots: ["main-category-cards.png", "floating-life-task.png", "main-focus-active.png", "floating-focus-active.png", "main-focus-modal.png", "main-focus-modal-dark.png", "floating-after-complete.png"]
  };
  fs.writeFileSync(path.join(outputDir, "visual-qa-result.json"), JSON.stringify(report, null, 2));
  quitting = true;
  app.exit(report.ok && rendererErrors.length === 0 ? 0 : 1);
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

// ---- 自动更新：检查 GitHub Releases，有新版本后台下载，就绪后询问重启 ----
function setupAutoUpdater() {
  if (!app.isPackaged || !autoUpdater) return; // 开发模式或未打包 electron-updater 时跳过
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", (info) => {
    console.log("[update] v" + info.version + " 可用，开始后台下载");
  });
  autoUpdater.on("update-downloaded", (info) => {
    const target = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    dialog.showMessageBox(target, {
      type: "info",
      title: "留痕 · 更新就绪",
      message: "新版本 v" + info.version + " 已下载完成",
      detail: "重启应用即可完成更新，数据不会丢失。",
      buttons: ["立即重启", "稍后"],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    }).catch(() => { /* 用户取消对话框不阻塞 */ });
  });
  autoUpdater.on("error", (err) => {
    console.error("[update] " + (err && err.message ? err.message : err));
  });
  autoUpdater.checkForUpdates().catch((err) => {
    console.error("[update] 检查失败: " + (err && err.message ? err.message : err));
  });
}

app.whenReady().then(async () => {
  traceDb = await openTraceDb(dataRoot());
  console.log("trace-db ready at " + traceDb.dataRoot);
  if (process.env.TRACE_SMOKE === "1") {
    runSmoke();
    return;
  }
  loadFloatingPrefs();
  createWindow();
  createFloatingWindow();
  if (process.env.TRACE_VISUAL_QA) {
    runVisualQa().catch((err) => {
      try {
        fs.writeFileSync(path.join(path.resolve(process.env.TRACE_VISUAL_QA), "visual-qa-result.json"), JSON.stringify({ ok: false, error: String(err) }, null, 2));
      } catch (writeErr) { /* 测试结果写入失败 */ }
      app.exit(1);
    });
    return;
  }
  setupAutoUpdater();
  app.on("activate", () => {
    if (!mainWindow) createWindow();
  });
});

app.on("before-quit", () => { quitting = true; });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/* ---- IPC：状态 ---- */
ipcMain.handle("db:getState", () => {
  try { return traceDb.getState(); } catch (err) { return null; }
});

/* 自动备份：把当前状态写入 {dataRoot}/backups/留痕-备份-{时间戳}.json */
ipcMain.handle("backup:create", () => {
  try {
    const state = traceDb.getState();
    if (!state) return { ok: false, error: "无数据可备份" };
    const backupsDir = path.join(traceDb.dataRoot, "backups");
    fs.mkdirSync(backupsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const file = path.join(backupsDir, "留痕-备份-" + stamp + ".json");
    fs.writeFileSync(file, JSON.stringify(state, null, 2), "utf8");
    return { ok: true, file };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle("db:putState", (e, data) => {
  if (!data || typeof data !== "object" || !data.meta || !data.days) {
    return { ok: false, error: "state 格式不正确" };
  }
  try {
    const oldIds = new Set(traceTaskSummaries(traceDb.getState()).map((task) => task.id));
    traceDb.putState(data);
    const added = traceTaskSummaries(data).some((task) => !task.completed && !oldIds.has(task.id));
    broadcastTaskSnapshot(added);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

/* ---- IPC：悬浮待办与跨窗口任务同步 ---- */
ipcMain.handle("tasks:getSnapshot", () => taskSnapshot());

ipcMain.handle("focus:getState", () => ({ active: focusSessionSnapshot() }));

ipcMain.handle("focus:start", (e, payload) => {
  const source = payload && payload.source === "workbench" ? "workbench" : "trace";
  const taskId = String(payload && payload.taskId || "");
  if (!taskId) return { ok: false, error: "任务参数不完整" };
  if (activeFocusSession) return { ok: false, error: "已有任务正在专注", active: focusSessionSnapshot() };

  let task = null;
  if (source === "trace") {
    const data = traceDb.getState();
    if (data && data.settings && data.settings.pomodoroEnabled === false) {
      return { ok: false, error: "专注番茄钟已关闭" };
    }
    Object.keys(data && data.days || {}).some((date) => {
      task = (data.days[date].tasks || []).find((item) => String(item.id) === taskId) || null;
      return !!task;
    });
  } else {
    task = workbenchTasks.find((item) => String(item.id) === taskId) || null;
  }
  if (!task) return { ok: false, error: "任务不存在" };
  if (task.status === "done" || task.completed) return { ok: false, error: "已完成任务不能开始专注" };

  activeFocusSession = {
    key: source + ":" + taskId,
    taskId,
    source,
    title: String(payload && payload.title || task.text || task.title || "当前任务"),
    category: (payload && payload.category) === "life" ? "life" : "work",
    startedAt: Date.now(),
    accumulatedMs: 0,
    paused: false
  };
  const next = broadcastFocusState();
  return { ok: true, active: next.active };
});

ipcMain.handle("focus:pause", (e, payload) => {
  if (!activeFocusSession) return { ok: false, error: "当前没有专注会话" };
  const pause = !!(payload && payload.paused);
  if (pause && !activeFocusSession.paused) {
    activeFocusSession.accumulatedMs = focusElapsedMs(activeFocusSession);
    activeFocusSession.startedAt = Date.now();
    activeFocusSession.paused = true;
  } else if (!pause && activeFocusSession.paused) {
    activeFocusSession.startedAt = Date.now();
    activeFocusSession.paused = false;
  }
  const next = broadcastFocusState();
  return { ok: true, active: next.active };
});

ipcMain.handle("focus:stop", (e, payload) => {
  if (!activeFocusSession) return { ok: false, error: "当前没有专注会话" };
  const session = activeFocusSession;
  const cancelled = !!(payload && payload.cancel);
  const sessionSeconds = Math.max(0, Math.floor(focusElapsedMs(session) / 1000));
  activeFocusSession = null;

  if (cancelled) {
    broadcastFocusState();
    return { ok: true, cancelled: true, sessionSeconds };
  }

  try {
    const data = traceDb.getState();
    const today = localDateKey();
    if (!data.days[today]) data.days[today] = { tasks: [], checkIn: null, focusSeconds: 0 };
    const beforeDaySeconds = Math.max(0, Number(data.days[today].focusSeconds) || 0);
    data.days[today].focusSeconds = beforeDaySeconds + sessionSeconds;
    let taskFocusSeconds = sessionSeconds;

    if (session.source === "trace") {
      let task = null;
      Object.keys(data.days || {}).some((date) => {
        task = (data.days[date].tasks || []).find((item) => String(item.id) === session.taskId) || null;
        return !!task;
      });
      if (!task) throw new Error("任务不存在，无法结算专注时长");
      task.focusSeconds = Math.max(0, Number(task.focusSeconds) || 0) + sessionSeconds;
      task.updatedAt = new Date().toISOString();
      taskFocusSeconds = task.focusSeconds;
    } else {
      const task = workbenchTasks.find((item) => String(item.id) === session.taskId);
      if (task) {
        task.focusSeconds = Math.max(0, Number(task.focusSeconds) || 0) + sessionSeconds;
        task.updatedAt = new Date().toISOString();
        taskFocusSeconds = task.focusSeconds;
      }
    }

    data.settings = data.settings || {};
    if (typeof data.settings.pomodoroEnabled !== "boolean") data.settings.pomodoroEnabled = true;
    data.meta.updatedAt = new Date().toISOString();
    traceDb.putState(data);
    broadcastTaskSnapshot(false);
    broadcastFocusState();
    return {
      ok: true,
      cancelled: false,
      sessionSeconds,
      taskFocusSeconds,
      dayFocusSeconds: data.days[today].focusSeconds,
      message: focusMessage(sessionSeconds),
      milestone: focusMilestone(beforeDaySeconds, data.days[today].focusSeconds)
    };
  } catch (err) {
    broadcastFocusState();
    return { ok: false, error: String(err), sessionSeconds };
  }
});

ipcMain.handle("workbench:syncTasks", (e, tasks) => {
  const oldIds = new Set(workbenchTasks.map((task) => task.id));
  const next = sanitizeWorkbenchTasks(tasks);
  const added = workbenchInitialized && next.some((task) => !task.completed && !oldIds.has(task.id));
  workbenchTasks = next;
  workbenchInitialized = true;
  broadcastTaskSnapshot(added);
  return { ok: true };
});

ipcMain.handle("tasks:complete", (e, payload) => {
  const source = payload && payload.source;
  const id = payload && String(payload.id || "");
  if (!id) return { ok: false, error: "任务参数不完整" };
  if (source === "trace") {
    try {
      const data = traceDb.getState();
      let found = false;
      Object.keys(data.days || {}).forEach((date) => {
        const tasks = Array.isArray(data.days[date].tasks) ? data.days[date].tasks : [];
        tasks.forEach((task) => {
          if (String(task.id) !== id) return;
          task.status = "done";
          task.completedAt = new Date().toISOString();
          task.updatedAt = task.completedAt;
          found = true;
        });
      });
      if (!found) return { ok: false, error: "任务不存在" };
      data.meta.updatedAt = new Date().toISOString();
      traceDb.putState(data);
      broadcastTaskSnapshot(false);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
  if (source === "workbench") {
    const task = workbenchTasks.find((item) => item.id === id);
    if (!task) return { ok: false, error: "任务不存在" };
    task.status = "已完成";
    task.completed = true;
    task.updatedAt = new Date().toISOString();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("workbench:completeTask", { id });
    }
    broadcastTaskSnapshot(false);
    return { ok: true };
  }
  return { ok: false, error: "未知任务来源" };
});

ipcMain.handle("floating:getState", () => ({ visible: floatingPrefs.visible, material: floatingMaterial }));
ipcMain.handle("floating:toggle", () => ({ visible: setFloatingVisible(!floatingPrefs.visible, false) }));
ipcMain.handle("floating:hide", () => ({ visible: setFloatingVisible(false, true) }));
ipcMain.handle("window:minimize", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});
ipcMain.handle("window:close", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});
ipcMain.handle("window:maximize", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMaximized()) { mainWindow.unmaximize(); return false; }
  mainWindow.maximize();
  return true;
});

ipcMain.handle("floating:openMain", () => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return true;
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
