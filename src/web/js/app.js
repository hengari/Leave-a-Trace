"use strict";

/* ============ 常量与工具 ============ */
const STORAGE_KEY = "trace:v1";
const SNAPSHOT_KEY = "trace:snapshot";
const DAY_MS = 86400000;
/* 通过 http(s) 打开时启用后端同步（本地/局域网服务模式） */
const SERVER = location.protocol === "http:" || location.protocol === "https:";
/* Electron 桌面端：通过 IPC 直连统一数据库 */
const DESKTOP = !!(window.traceDesktop && window.traceDesktop.isDesktop);
const REMOTE = SERVER || DESKTOP;
const TASK_CATEGORIES = { work: "工作事务", life: "生活事务" };

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function uid(prefix) {
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function pad(n) { return String(n).padStart(2, "0"); }

function dateStr(d) {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function todayStr() { return dateStr(new Date()); }

function taskCategory(task) {
  return task && TASK_CATEGORIES[task.category] ? task.category : "work";
}

function categoryLabel(taskOrCategory) {
  const value = typeof taskOrCategory === "string" ? taskOrCategory : taskCategory(taskOrCategory);
  return TASK_CATEGORIES[value] || TASK_CATEGORIES.work;
}

function filterByCategory(tasks, category) {
  return category === "all" ? tasks : tasks.filter((task) => taskCategory(task) === category);
}

function selectedTaskCategory() {
  return TASK_CATEGORIES[state.settings.lastTaskCategory] ? state.settings.lastTaskCategory : "work";
}

function renderTaskCategoryPicker(tasks) {
  const selected = selectedTaskCategory();
  $$('[data-task-category]').forEach((button) => {
    const category = button.dataset.taskCategory;
    const active = category === selected;
    const count = tasks.filter((task) => taskCategory(task) === category && task.status !== "done").length;
    button.setAttribute("aria-checked", String(active));
    button.tabIndex = active ? 0 : -1;
    const countEl = button.querySelector(".task-category-count");
    const selectedEl = button.querySelector(".task-category-selected");
    if (countEl) countEl.textContent = String(count);
    if (selectedEl) selectedEl.hidden = !active;
  });
}

function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function weekdayCN(d) { return "日一二三四五六"[d.getDay()]; }

function fmtClock(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return dateStr(d) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function fmtShortDate(s) {
  if (!s) return "";
  const d = parseDate(s);
  return (d.getMonth() + 1) + "/" + d.getDate();
}

function hourMinToToday(h, m) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

function hourMinOnDate(dateKey, h, m) {
  const d = parseDate(dateKey);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpColor(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * Math.min(1, Math.max(0, t))));
  return "rgb(" + c.join(",") + ")";
}

const ACCENT = "#2e7d5b";
const AMBER = "#b7791f";

function toast(text, warn) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.toggle("warn", !!warn);
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2400);
}

function formatFocusDuration(seconds, compact) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (compact) return hours ? hours + " 小时 " + minutes + " 分" : minutes + " 分";
  const secs = total % 60;
  return hours ? hours + ":" + pad(minutes) + ":" + pad(secs) : pad(minutes) + ":" + pad(secs);
}

function pomodoroEnabled() {
  return !!(DESKTOP && state && state.settings && state.settings.pomodoroEnabled !== false);
}

/* ============ 存储层（输入即存，单出口） ============ */
let state = null;
let activeFocusSession = null;
let focusTickTimer = null;
let focusModalOpen = false;

function emptyState() {
  return {
    meta: {
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      recordCount: 0,
      nextBackupHintAt: 20
    },
    days: {},
    files: [],
    monthlyReports: [],
    finance: { items: [] },
    settings: {
      gradientThresholdMin: 60,
      style: "paper",
      backupReminderEnabled: true,
      lastTaskCategory: "work",
      pomodoroEnabled: true
    }
  };
}

function demoState() {
  const st = emptyState();
  const now = new Date();
  const d0 = dateStr(now);
  const d1 = dateStr(new Date(now.getTime() - DAY_MS));
  const d2 = dateStr(new Date(now.getTime() - 2 * DAY_MS));

  const yesterdayOverdue = new Date(now.getTime() - DAY_MS);
  yesterdayOverdue.setHours(18, 0, 0, 0);
  const nearDeadline = new Date(now.getTime() + 30 * 60000);
  const todayDeadline = new Date(now.getTime() + 3 * 3600000);

  st.days[d0] = {
    tasks: [
      {
        id: uid("t"), text: "编写留痕项目方案", status: "in_progress",
        createdAt: new Date(now.getTime() - 2 * 3600000).toISOString(),
        deadline: todayDeadline.toISOString(), completedAt: null, tags: ["方案"], note: "含热力图对标", category: "work", order: 0
      },
      {
        id: uid("t"), text: "晨会纪要", status: "done",
        createdAt: new Date(now.getTime() - 5 * 3600000).toISOString(),
        deadline: null, completedAt: new Date(now.getTime() - 4 * 3600000).toISOString(), tags: [], note: "", category: "work", order: 1
      },
      {
        id: uid("t"), text: "回复客户邮件", status: "pending",
        createdAt: new Date(now.getTime() - 6 * 3600000).toISOString(),
        deadline: yesterdayOverdue.toISOString(), completedAt: null, tags: ["客户"], note: "", category: "work", order: 2
      },
      {
        id: uid("t"), text: "整理本周报表", status: "in_progress",
        createdAt: new Date(now.getTime() - 1 * 3600000).toISOString(),
        deadline: nearDeadline.toISOString(), completedAt: null, tags: [], note: "", category: "work", order: 3
      }
    ],
    checkIn: null
  };
  st.days[d1] = {
    tasks: [
      {
        id: uid("t"), text: "周报撰写", status: "done",
        createdAt: new Date(now.getTime() - DAY_MS - 3 * 3600000).toISOString(),
        deadline: null, completedAt: new Date(now.getTime() - DAY_MS - 1 * 3600000).toISOString(), tags: [], note: "", category: "work", order: 0
      },
      {
        id: uid("t"), text: "需求评审", status: "done",
        createdAt: new Date(now.getTime() - DAY_MS - 5 * 3600000).toISOString(),
        deadline: null, completedAt: new Date(now.getTime() - DAY_MS - 2 * 3600000).toISOString(), tags: [], note: "", category: "work", order: 1
      }
    ],
    checkIn: { checked: true, checkedAt: new Date(now.getTime() - DAY_MS - 3 * 3600000).toISOString() }
  };
  st.days[d2] = {
    tasks: [
      {
        id: uid("t"), text: "阅读《深度工作》第 3 章", status: "done",
        createdAt: new Date(now.getTime() - 2 * DAY_MS - 4 * 3600000).toISOString(),
        deadline: null, completedAt: new Date(now.getTime() - 2 * DAY_MS - 2 * 3600000).toISOString(), tags: [], note: "", category: "life", order: 0
      },
      {
        id: uid("t"), text: "整理读书笔记", status: "pending",
        createdAt: new Date(now.getTime() - 2 * DAY_MS - 2 * 3600000).toISOString(),
        deadline: null, completedAt: null, tags: [], note: "", category: "life", order: 1
      }
    ],
    checkIn: null
  };
  st.files = [
    {
      id: uid("f"), name: "周报-2026-W32.xlsx", type: "xlsx",
      path: "attachments/2026/08/周报-2026-W32.xlsx", size: 24576,
      date: d1, tags: ["周报"], importedAt: new Date(now.getTime() - DAY_MS - 1 * 3600000).toISOString()
    }
  ];
  const savedStyle = localStorage.getItem("trace:style")
    || (localStorage.getItem("trace:theme") === "dark" ? "dark" : "paper");
  // 旧版「现代克制」已下线，映射为「暖光日记」
  st.settings.style = savedStyle === "modern" ? "warm" : savedStyle;
  return st;
}

function save(replace) {
  const count = countRecords();
  const hint = state.meta.nextBackupHintAt;
  if (state.settings.backupReminderEnabled && hint > 0 && count >= hint) {
    state.meta.nextBackupHintAt = count + 25;
    autoBackup(count);
  }
  state.meta.recordCount = count;
  state.meta.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    toast("保存失败：数据未落盘，请检查磁盘空间", true);
  }
  scheduleServerSave(replace);
}

/* 自动备份：超过阈值(25 条)自动把状态备份到 backups 文件夹，仅提示"已备份" */
async function autoBackup(count) {
  if (DESKTOP && window.traceDesktop.createBackup) {
    try {
      const r = await window.traceDesktop.createBackup();
      toast(r && r.ok ? "已自动备份到备份文件夹" : "自动备份失败：" + (r && r.error || "未知错误"), !!r && !r.ok);
    } catch (err) { toast("自动备份失败：" + err, true); }
    return;
  }
  if (SERVER) {
    try {
      const res = await fetch("/api/backup", { method: "POST" });
      const r = await res.json();
      toast(r && r.ok ? "已自动备份到备份文件夹" : "自动备份失败：" + (r && r.error || "未知错误"), !!r && !r.ok);
    } catch (err) { toast("自动备份失败：" + err, true); }
    return;
  }
  // file:// 纯本地模式无法写文件，保留手动提示
  setTimeout(() => toast("已累计 " + count + " 条记录，建议手动导出备份", true), 400);
}

/* ============ 后端同步（服务模式） ============ */
async function apiGetState() {
  if (DESKTOP) {
    try { return (await window.traceDesktop.getState()) || null; } catch (err) { return null; }
  }
  try {
    const res = await fetch("/api/state");
    if (!res.ok) return null;
    const body = await res.json();
    return body && body.data ? body.data : null;
  } catch (err) {
    return null;
  }
}

let serverSaveTimer = null;
function scheduleServerSave(replace) {
  if (!REMOTE) return;
  clearTimeout(serverSaveTimer);
  serverSaveTimer = setTimeout(() => {
    if (DESKTOP) {
      const fn = replace && window.traceDesktop.putStateReplace
        ? window.traceDesktop.putStateReplace
        : window.traceDesktop.putState;
      fn(state).catch(() => toast("保存失败：数据未写入数据库", true));
    } else {
      fetch("/api/state" + (replace ? "?replace=1" : ""), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state)
      }).catch(() => toast("服务器保存失败，数据暂存本地", true));
    }
  }, 300);
}

function uploadServerFile(file, name, date, tags, importedAt) {
  if (DESKTOP) {
    return readFileAsDataUrl(file).then((dataUrl) => {
      if (!dataUrl) return null;
      return window.traceDesktop.uploadFile({ name, date, tags: tags || [], importedAt, dataUrl })
        .then((r) => (r && r.ok ? r : null))
        .catch(() => null);
    });
  }
  try {
    const params = new URLSearchParams({
      name,
      date,
      tags: JSON.stringify(tags || []),
      importedAt
    });
    return fetch("/api/files?" + params.toString(), { method: "POST", body: file })
      .then((res) => (res.ok ? res.json() : Promise.resolve(null)))
      .catch(() => null);
  } catch (err) {
    return Promise.resolve(null);
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

async function fetchFileDataUrl(id) {
  if (DESKTOP) {
    try {
      const r = await window.traceDesktop.getFileDataUrl(id);
      return r && r.ok ? r.dataUrl : "";
    } catch (err) { return ""; }
  }
  try {
    const res = await fetch("/api/files/" + encodeURIComponent(id) + "/raw");
    if (!res.ok) return "";
    return await readFileAsDataUrl(await res.blob());
  } catch (err) {
    return "";
  }
}

async function deleteServerFile(id) {
  if (DESKTOP) {
    const r = await window.traceDesktop.deleteFile(id);
    if (!(r && r.ok)) throw new Error("删除失败");
    return;
  }
  const res = await fetch("/api/files/" + encodeURIComponent(id), { method: "DELETE" });
  if (!res.ok) throw new Error("HTTP " + res.status);
}

function countRecords() {
  let n = 0;
  Object.keys(state.days).forEach((d) => { n += (state.days[d].tasks || []).length; });
  return n + (state.files || []).length;
}

function takeSnapshot() {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ at: new Date().toISOString(), data: state }));
  } catch (err) { /* 快照失败不阻塞 */ }
}

async function load() {
  if (REMOTE) {
    const remote = await apiGetState();
    if (remote && remote.meta && remote.days) {
      state = normalize(remote);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (err) { /* 仅缓存 */ }
      return;
    }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const demo = demoState();
      state = demo;
      save();
      takeSnapshot();
      return;
    }
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || !data.meta || !data.days) {
      throw new Error("数据格式不正确");
    }
    state = normalize(data);
    if (!localStorage.getItem(SNAPSHOT_KEY)) takeSnapshot();
  } catch (err) {
    quarantineCorrupt(err.message);
  }
}

function normalize(data) {
  const base = emptyState();
  const merged = {
    meta: Object.assign(base.meta, data.meta || {}),
    days: data.days || {},
    files: Array.isArray(data.files) ? data.files : [],
    monthlyReports: Array.isArray(data.monthlyReports)
      ? data.monthlyReports.map((r) => ({
          id: r.id || uid("monthly"),
          year: r.year, month: r.month, title: r.title || "",
          md: r.md || "", fileName: r.fileName || "",
          createdAt: r.createdAt || new Date().toISOString()
        }))
      : [],
    settings: Object.assign(base.settings, data.settings || {})
  };
  if (typeof merged.meta.nextBackupHintAt !== "number" || merged.meta.nextBackupHintAt < 0) {
    merged.meta.nextBackupHintAt = base.meta.nextBackupHintAt;
  }
  if (!merged.settings.style) {
    merged.settings.style = merged.settings.theme === "dark" ? "dark" : "paper";
  }
  if (!TASK_CATEGORIES[merged.settings.lastTaskCategory]) {
    merged.settings.lastTaskCategory = "work";
  }
  if (typeof merged.settings.pomodoroEnabled !== "boolean") merged.settings.pomodoroEnabled = true;
  Object.keys(merged.days).forEach((date) => {
    const day = merged.days[date] || {};
    day.focusSeconds = Math.max(0, Number(day.focusSeconds) || 0);
    day.tasks = Array.isArray(day.tasks) ? day.tasks.map((task) => Object.assign({}, task, {
      category: taskCategory(task),
      note: typeof task.note === "string" ? task.note : "",
      focusSeconds: Math.max(0, Number(task.focusSeconds) || 0),
      updatedAt: task.updatedAt || task.createdAt || new Date().toISOString()
    })) : [];
    if (!("checkIn" in day)) day.checkIn = null;
    merged.days[date] = day;
  });
  return merged;
}

function quarantineCorrupt(msg) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) localStorage.setItem(STORAGE_KEY + ".corrupt-" + Date.now(), raw);
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) { /* 忽略隔离失败 */ }
  $("#corrupt-msg").textContent = "检测到本地数据损坏（" + msg + "），原数据已隔离为备份。请选择恢复方式：";
  $("#corrupt-modal").classList.remove("hidden");
}

/* ============ 主题 ============ */
function applyTheme(style) {
  if (style === "modern") style = "warm";
  document.documentElement.dataset.theme = style;
  const icon = $("#theme-icon");
  if (icon) icon.textContent = style === "warm" ? "☀" : "☾";
  const name = $("#theme-name");
  if (name) name.textContent = style === "dark" ? "极夜" : (style === "warm" ? "晴空" : "暖阳");
  const sel = $("#theme-select");
  if (sel) sel.value = style;
  try { localStorage.setItem("trace:style", style); } catch (err) {}
}

/* ============ 路由 ============ */
function currentView() {
  const h = location.hash.replace("#", "");
  return ["today", "monthly", "files", "finance", "backup", "settings", "workbench"].indexOf(h) >= 0 ? h : "today";
}

function renderRoute() {
  const view = currentView();
  document.body.dataset.page = view;
  $$(".view").forEach((el) => el.classList.remove("active"));
  $("#view-" + view).classList.add("active");
  $$(".nav-link").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("href") === "#" + view);
  });
  if (view === "today") renderToday();
  if (view === "monthly") renderMonthly();
  if (view === "files") renderFiles();
  if (view === "backup") renderBackup();
  if (view === "settings") renderSettings();
  if (view === "workbench" && typeof renderWorkbench === "function") renderWorkbench();
  if (view === "finance") renderFinanceRoute();
}

/* ============ 今日页 ============ */
let cursorDate = todayStr();
let todayCategoryFilter = "all";

function dayTasks(date) {
  const own = (state.days[date] && state.days[date].tasks) || [];
  const seen = new Set(own.map((t) => t.id));
  const merged = own.slice();
  allTasks().forEach((t) => {
    if (!seen.has(t.id) && taskActiveOn(t, date)) merged.push(t);
  });
  return merged;
}

function allTasks() {
  const out = [];
  Object.keys(state.days).forEach((d) => {
    (state.days[d].tasks || []).forEach((t) => out.push(t));
  });
  return out;
}

function taskActiveOn(task, date) {
  if (!task.startDate) return false;
  const end = task.deadline ? dateStr(new Date(task.deadline)) : task.startDate;
  return task.startDate <= date && date <= end;
}

function ensureDay(date) {
  if (!state.days[date]) state.days[date] = { tasks: [], checkIn: null, focusSeconds: 0 };
  if (!Number.isFinite(Number(state.days[date].focusSeconds))) state.days[date].focusSeconds = 0;
  return state.days[date];
}

function isOverdue(task) {
  return task.status !== "done" && task.deadline && new Date(task.deadline).getTime() < Date.now() && !task.givenUp;
}

function focusElapsedSeconds(session) {
  if (!session) return 0;
  const base = Math.max(0, Number(session.accumulatedMs) || 0);
  const live = session.paused ? 0 : Math.max(0, Date.now() - Number(session.startedAt || Date.now()));
  return Math.floor((base + live) / 1000);
}

function updateFocusModal() {
  const modal = $("#focus-modal");
  if (!modal) return;
  if (!activeFocusSession || !focusModalOpen) {
    modal.classList.add("hidden");
    clearInterval(focusTickTimer);
    focusTickTimer = null;
    return;
  }
  modal.classList.remove("hidden");
  $("#focus-modal-title").textContent = activeFocusSession.title || "当前任务";
  $("#focus-task-meta").textContent = categoryLabel(activeFocusSession.category) + (activeFocusSession.paused ? " · 已暂停" : " · 正在专注");
  const seconds = focusElapsedSeconds(activeFocusSession);
  $("#focus-ring-time").textContent = formatFocusDuration(seconds, false);
  const circumference = 2 * Math.PI * 64;
  const progress = (seconds % (25 * 60)) / (25 * 60);
  const ring = $("#focus-ring-progress");
  ring.style.strokeDasharray = String(circumference);
  ring.style.strokeDashoffset = String(circumference * (1 - progress));
  $("#focus-pause").textContent = activeFocusSession.paused ? "继续" : "暂停";
}

function showFocusModal() {
  focusModalOpen = true;
  updateFocusModal();
  if (!focusTickTimer) focusTickTimer = setInterval(updateFocusModal, 1000);
}

function closeFocusModal() {
  focusModalOpen = false;
  updateFocusModal();
}

async function refreshDesktopState() {
  const remote = await apiGetState();
  if (!remote || !remote.meta || !remote.days) return;
  state = normalize(remote);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (err) { /* 仅缓存 */ }
  renderRoute();
}

async function openFocusModal(task) {
  if (!DESKTOP || !pomodoroEnabled()) return;
  const key = "trace:" + task.id;
  if (activeFocusSession) {
    if (activeFocusSession.key === key) showFocusModal();
    else toast("正在专注：“" + activeFocusSession.title + "”", true);
    return;
  }
  const result = await window.traceDesktop.focusStart({
    source: "trace",
    taskId: task.id,
    title: task.text,
    category: taskCategory(task)
  });
  if (!result || !result.ok) {
    toast((result && result.error) || "无法开始专注", true);
    return;
  }
  activeFocusSession = result.active;
  showFocusModal();
  renderToday();
}

async function toggleFocusPause() {
  if (!activeFocusSession) return;
  const result = await window.traceDesktop.focusPause({ paused: !activeFocusSession.paused });
  if (!result || !result.ok) return toast((result && result.error) || "操作失败", true);
  activeFocusSession = result.active;
  updateFocusModal();
}

async function finishFocus(cancel) {
  if (!activeFocusSession) return;
  const result = await window.traceDesktop.focusStop({ cancel: !!cancel });
  if (!result || !result.ok) {
    toast((result && result.error) || "专注结算失败", true);
    return;
  }
  activeFocusSession = null;
  closeFocusModal();
  await refreshDesktopState();
  if (cancel) toast("本次专注已取消，未计入时长");
  else toast([result.message, result.milestone].filter(Boolean).join(" · "));
}

function renderTodayFocus() {
  const el = $("#today-focus-stat");
  if (!el) return;
  const enabled = pomodoroEnabled();
  el.classList.toggle("hidden", !enabled);
  if (!enabled) return;
  const seconds = Number(ensureDay(cursorDate).focusSeconds) || 0;
  el.textContent = (cursorDate === todayStr() ? "今日专注 " : "当日专注 ") + formatFocusDuration(seconds, true);
}

function renderToday() {
  const d = parseDate(cursorDate);
  $("#day-title").textContent = (d.getMonth() + 1) + "月" + d.getDate() + "日 星期" + weekdayCN(d);
  const allDayTasks = dayTasks(cursorDate).slice().sort((a, b) => a.order - b.order);
  const tasks = filterByCategory(allDayTasks, todayCategoryFilter);
  const scopeLabel = todayCategoryFilter === "all" ? "全部事务" : categoryLabel(todayCategoryFilter);
  $("#day-sub").textContent = (cursorDate === todayStr() ? "今天" : "历史记录") + " · " + scopeLabel + " " + tasks.length + " 项";

  $("#write-banner").classList.toggle("hidden", cursorDate === todayStr());
  $("#today-btn").classList.toggle("hidden", cursorDate === todayStr());
  renderTaskCategoryPicker(allDayTasks);
  $$('[data-task-category-filter]').forEach((button) => {
    const category = button.dataset.taskCategoryFilter;
    const count = filterByCategory(allDayTasks, category).length;
    button.classList.toggle("active", category === todayCategoryFilter);
    button.textContent = (category === "all" ? "全部" : categoryLabel(category)) + " " + count;
  });
  const followup = tasks.filter(isOverdue);
  const others = tasks.filter((t) => !isOverdue(t));

  const done = tasks.filter((t) => t.status === "done").length;
  const doing = tasks.filter((t) => t.status === "in_progress").length;
  const pending = tasks.filter((t) => t.status === "pending").length;

  $("#progress-text").textContent = "已完成 " + done + " / " + tasks.length;
  $("#progress-fill").style.width = tasks.length ? (done / tasks.length) * 100 + "%" : "0%";
  $("#badge-doing").textContent = "进行中 " + doing;
  $("#badge-done").textContent = "已完成 " + done;
  $("#badge-pending").textContent = "未完成 " + pending;

  $("#followup-panel").classList.toggle("hidden", followup.length === 0);
  $("#followup-count").textContent = followup.length + " 项";
  renderTaskList($("#followup-list"), followup, true);

  $("#task-count").textContent = others.length + " 项";
  renderTodayFocus();
  renderTaskList($("#task-list"), others, false);
  $("#empty-hint").classList.toggle("hidden", others.length > 0);

  renderCheckin();
}

function renderTaskList(listEl, tasks, followup) {
  listEl.textContent = "";
  if (!tasks.length) {
    const li = document.createElement("li");
    li.className = "empty-hint";
    li.textContent = followup ? "暂无逾期任务，做得很稳。" : "";
    listEl.appendChild(li);
    return;
  }
  const LIMIT = 5;
  tasks.forEach((task, i) => {
    const row = taskRow(task, followup);
    if (i >= LIMIT) row.classList.add("collapsed");
    listEl.appendChild(row);
  });
  if (tasks.length > LIMIT) {
    const extra = tasks.length - LIMIT;
    const more = document.createElement("li");
    more.className = "task-more";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "task-more-btn";
    const collapsedLabel = "展开剩余 " + extra + " 项 ▾";
    const expandedLabel = "收起 ▴";
    btn.textContent = collapsedLabel;
    btn.addEventListener("click", () => {
      const showAll = listEl.classList.toggle("expanded");
      btn.textContent = showAll ? expandedLabel : collapsedLabel;
    });
    more.appendChild(btn);
    listEl.appendChild(more);
  }
}

function taskRow(task, followup, interactive) {
  if (interactive === undefined) interactive = true;
  const li = document.createElement("li");
  li.className = "task-row" + (task.status === "done" ? " done" : "") + (isOverdue(task) ? " overdue" : "");
  li.dataset.task = task.id;

  const status = document.createElement("span");
  status.className = "task-status " + (isOverdue(task) ? "overdue" : task.status);
  status.title = task.status === "in_progress" ? "进行中（点击切换为未完成）"
    : task.status === "pending" ? "未完成（点击切换为进行中）" : "已完成";
  if (interactive) status.addEventListener("click", (e) => {
    e.stopPropagation();
    cycleStatus(task.id);
  });

  const check = document.createElement("button");
  check.type = "button";
  check.className = "task-check" + (task.status === "done" ? " done" : "");
  check.title = task.status === "done" ? "取消完成" : "标记完成";
  check.innerHTML = '<svg viewBox="0 0 12 12"><path d="M2 6.5 5 9.5 10 2.5"/></svg>';
  if (interactive) check.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDone(task.id);
  });
  else check.disabled = true;

  const main = document.createElement("div");
  main.className = "task-main";

  const text = document.createElement("span");
  text.className = "task-text";
  text.textContent = task.text;
  main.appendChild(text);

  const meta = document.createElement("div");
  meta.className = "task-meta";
  const category = document.createElement("button");
  category.type = "button";
  category.className = "task-category task-category-" + taskCategory(task);
  category.textContent = categoryLabel(task);
  category.title = "点击切换任务分类";
  if (interactive) category.addEventListener("click", (e) => {
    e.stopPropagation();
    setTaskCategory(task.id, taskCategory(task) === "work" ? "life" : "work");
  });
  else category.disabled = true;
  meta.appendChild(category);
  if (task.tags && task.tags.length) {
    const tag = document.createElement("span");
    tag.textContent = "#" + task.tags.join(" #");
    meta.appendChild(tag);
  }
  if (task.note) {
    const note = document.createElement("span");
    note.className = "task-note-preview";
    note.textContent = "备注：" + (task.note.length > 40 ? task.note.slice(0, 40) + "…" : task.note);
    note.title = task.note;
    meta.appendChild(note);
  }
  if (Number(task.focusSeconds) > 0) {
    const focused = document.createElement("span");
    focused.className = "task-focus-total";
    focused.textContent = "已专注 " + formatFocusDuration(task.focusSeconds, true);
    meta.appendChild(focused);
  }

  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "deadline-chip";
  updateChip(chip, task);
  if (interactive) chip.addEventListener("click", (e) => {
    e.stopPropagation();
    openDeadlineEditor(task);
  });
  else chip.disabled = true;
  meta.appendChild(chip);
  main.appendChild(meta);

  if (task.deadline && task.status !== "done" && !isOverdue(task)) {
    const timer = document.createElement("div");
    timer.className = "task-timer";
    const fill = document.createElement("span");
    const rangeStart = task.startDate
      ? new Date(task.startDate + "T" + (task.startTime || "00:00") + ":00")
      : new Date(task.createdAt);
    const total = Math.max(new Date(task.deadline) - rangeStart, 3600000);
    const remaining = new Date(task.deadline) - Date.now();
    const ratio = Math.min(1, Math.max(0, remaining / total));
    fill.style.width = Math.round(ratio * 100) + "%";
    fill.style.background = toneFor(task);
    timer.appendChild(fill);
    main.appendChild(timer);
  }

  if (interactive) {
    const actions = document.createElement("div");
    actions.className = "task-actions";
    if (followup) {
      const later = document.createElement("button");
      later.textContent = "顺延";
      later.title = "截止时间顺延 8 小时";
      later.addEventListener("click", (e) => {
        e.stopPropagation();
        postpone(task.id);
      });
      actions.appendChild(later);
      const giveUp = document.createElement("button");
      giveUp.textContent = "放弃";
      giveUp.title = "标记为未完成（归档）";
      giveUp.addEventListener("click", (e) => {
        e.stopPropagation();
        giveUpTask(task.id);
      });
      actions.appendChild(giveUp);
    }
    if (pomodoroEnabled() && task.status !== "done") {
      const focus = document.createElement("button");
      const focusing = activeFocusSession && activeFocusSession.key === "trace:" + task.id;
      focus.textContent = focusing ? "专注中" : "⏱ 专注";
      focus.className = "focus-task-btn" + (focusing ? " active" : "");
      focus.disabled = !!activeFocusSession;
      focus.title = focusing ? "当前任务正在专注" : activeFocusSession ? "请先结束当前专注" : "开始专注计时";
      focus.addEventListener("click", (e) => {
        e.stopPropagation();
        openFocusModal(task);
      });
      actions.appendChild(focus);
    }
    const noteBtn = document.createElement("button");
    noteBtn.textContent = task.note ? "编辑备注" : "备注";
    noteBtn.className = task.note ? "has-note" : "";
    noteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openTaskNote(task.id);
    });
    actions.appendChild(noteBtn);
    const del = document.createElement("button");
    del.textContent = "删除";
    del.className = "danger";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      removeTask(task.id);
    });
    actions.appendChild(del);
    li.append(status, check, main, actions);
  } else {
    li.append(status, check, main);
  }
  if (interactive) li.addEventListener("click", () => toggleDone(task.id));
  return li;
}

function updateChip(chip, task) {
  chip.className = "deadline-chip";
  if (task.deadline) {
    const dl = new Date(task.deadline);
    const dlDate = dateStr(dl);
    const sameDay = dateStr(dl) === cursorDate;
    const over = isOverdue(task);
    const near = !over && task.status !== "done" && dl.getTime() - Date.now() < state.settings.gradientThresholdMin * 60000;
    if (over) chip.classList.add("overdue");
    else if (near) chip.classList.add("near");
    let label;
    if (over) {
      label = "已逾期 " + Math.max(1, Math.round((Date.now() - dl.getTime()) / 3600000)) + " 小时";
    } else if (task.startDate && task.startDate !== dlDate) {
      label = fmtShortDate(task.startDate) + " " + (task.startTime || "00:00") + " → " +
        fmtShortDate(dlDate) + " " + fmtClock(task.deadline);
    } else {
      label = sameDay ? "截止 " + fmtClock(task.deadline) : "截止 " + fmtDateTime(task.deadline);
    }
    chip.textContent = label;
  } else {
    chip.textContent = "设置截止";
  }
}

function toneFor(task) {
  if (!task.deadline || task.status === "done") return ACCENT;
  const remaining = new Date(task.deadline) - Date.now();
  if (remaining <= 0) return "#b23b3b";
  const threshold = state.settings.gradientThresholdMin * 60000;
  const t = Math.min(1, Math.max(0, remaining / threshold));
  return lerpColor(AMBER, ACCENT, t);
}

/* ============ 截止时间编辑器（自定义日历 + 确定按钮 + 区间渐变） ============ */
let dlEditor = null; // { task, calYear, calMonth }

function openDeadlineEditor(task) {
  if (!dlEditor) {
    buildDeadlineModal();
    dlEditor = {};
  }
  dlEditor.task = task;
  const defaultStart = task.startDate || (task.deadline ? dateStr(new Date(task.deadline)) : cursorDate);
  const defaultEnd = task.deadline ? dateStr(new Date(task.deadline)) : defaultStart;
  $("#dl-start-date").value = defaultStart;
  $("#dl-start-time").value = task.startTime || "09:00";
  $("#dl-end-date").value = defaultEnd;
  $("#dl-end-time").value = task.deadline ? fmtClock(task.deadline) : "18:00";
  const base = parseDate(defaultStart || todayStr());
  dlEditor.calYear = base.getFullYear();
  dlEditor.calMonth = base.getMonth();
  renderDeadlineCalendar();
  $("#deadline-modal").classList.remove("hidden");
}

function buildDeadlineModal() {
  const mask = document.createElement("div");
  mask.className = "modal-mask hidden";
  mask.id = "deadline-modal";
  mask.innerHTML =
    '<div class="modal deadline-modal">' +
      "<h3>设置截止时间</h3>" +
      '<div class="range-row">' +
        "<label>开始时间" +
          '<span class="range-inputs"><input type="date" id="dl-start-date"><input type="time" id="dl-start-time"></span>' +
        "</label>" +
        "<label>截止时间" +
          '<span class="range-inputs"><input type="date" id="dl-end-date"><input type="time" id="dl-end-time"></span>' +
        "</label>" +
      "</div>" +
      '<div class="dl-calendar">' +
        '<div class="dl-cal-head">' +
          '<button class="icon-btn" type="button" id="dl-prev" title="上个月">‹</button>' +
          '<span class="dl-cal-title" id="dl-cal-title"></span>' +
          '<button class="icon-btn" type="button" id="dl-next" title="下个月">›</button>' +
        "</div>" +
        '<div class="dl-cal-grid" id="dl-cal-grid"></div>' +
      "</div>" +
      '<p class="dl-hint">点击日历选择开始与截止日期：开始和结束为深色，中间日期为浅色渐变。</p>' +
      '<div class="modal-actions">' +
        '<button class="ghost-btn" type="button" id="dl-clear">清除截止</button>' +
        '<button class="ghost-btn" type="button" id="dl-cancel">取消</button>' +
        '<button class="primary-btn" type="button" id="dl-ok">确定</button>' +
      "</div>" +
    "</div>";
  document.body.appendChild(mask);

  mask.addEventListener("click", (e) => {
    if (e.target === mask) closeDeadlineModal();
  });
  $("#dl-ok").addEventListener("click", applyDeadline);
  $("#dl-cancel").addEventListener("click", closeDeadlineModal);
  $("#dl-clear").addEventListener("click", clearDeadline);
  $("#dl-prev").addEventListener("click", () => {
    dlEditor.calMonth -= 1;
    if (dlEditor.calMonth < 0) { dlEditor.calMonth = 11; dlEditor.calYear -= 1; }
    renderDeadlineCalendar();
  });
  $("#dl-next").addEventListener("click", () => {
    dlEditor.calMonth += 1;
    if (dlEditor.calMonth > 11) { dlEditor.calMonth = 0; dlEditor.calYear += 1; }
    renderDeadlineCalendar();
  });
  ["dl-start-date", "dl-end-date"].forEach((id) => {
    $("#" + id).addEventListener("change", renderDeadlineCalendar);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dlEditor && !$("#deadline-modal").classList.contains("hidden")) {
      closeDeadlineModal();
    }
  });
}

function closeDeadlineModal() {
  $("#deadline-modal").classList.add("hidden");
  dlEditor.task = null;
  renderToday();
}

function clearDeadline() {
  const task = dlEditor.task;
  if (!task) return;
  task.startDate = undefined;
  task.startTime = undefined;
  task.deadline = null;
  save();
  closeDeadlineModal();
  toast("已清除截止时间");
}

function applyDeadline() {
  const task = dlEditor.task;
  if (!task) return;
  const sd = $("#dl-start-date").value;
  const ed = $("#dl-end-date").value;
  const st = $("#dl-start-time").value || "00:00";
  const et = $("#dl-end-time").value || "23:59";
  if (!sd || !ed) { toast("请选择开始与截止日期", true); return; }
  if (ed < sd) { toast("截止日期不能早于开始日期", true); return; }
  task.startDate = sd;
  task.startTime = st;
  task.deadline = new Date(ed + "T" + et + ":00").toISOString();
  task.givenUp = false;
  save();
  closeDeadlineModal();
  toast("已设置截止时间");
}

function renderDeadlineCalendar() {
  const title = $("#dl-cal-title");
  const grid = $("#dl-cal-grid");
  if (!title || !grid || !dlEditor) return;
  const y = dlEditor.calYear, m = dlEditor.calMonth;
  title.textContent = y + " 年 " + (m + 1) + " 月";
  grid.textContent = "";
  ["一", "二", "三", "四", "五", "六", "日"].forEach((w) => {
    const c = document.createElement("span");
    c.className = "dow";
    c.textContent = w;
    grid.appendChild(c);
  });
  const first = new Date(y, m, 1);
  const startOffset = (first.getDay() + 6) % 7; // 周一开头
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const startDate = $("#dl-start-date").value;
  const endDate = $("#dl-end-date").value;
  for (let i = 0; i < startOffset; i++) {
    const c = document.createElement("span");
    c.className = "dl-day out";
    grid.appendChild(c);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = y + "-" + pad(m + 1) + "-" + pad(d);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dl-day";
    btn.textContent = d;
    btn.dataset.date = ds;
    if (ds === todayStr()) btn.classList.add("today");
    if (startDate && endDate && startDate <= ds && ds <= endDate) {
      btn.style.background = rangeTone(ds, startDate, endDate);
      if (ds === startDate || ds === endDate) {
        btn.classList.add("range-edge");
        btn.style.color = "#fff";
        btn.style.fontWeight = "700";
      }
    }
    btn.addEventListener("click", () => {
      const s = $("#dl-start-date").value;
      if (!s || ds < s) {
        $("#dl-start-date").value = ds;
      } else {
        $("#dl-end-date").value = ds;
      }
      renderDeadlineCalendar();
    });
    grid.appendChild(btn);
  }
}

const RANGE_BASE = {
  paper: "#b8863c", // 暖阳：深香槟金
  dark: "#34d399",  // 极夜：冷绿
  warm: "#3d8bd4"   // 晴空：浅蓝
};

function rangeBase() {
  const theme = document.documentElement.dataset.theme || "paper";
  return RANGE_BASE[theme] || RANGE_BASE.paper;
}

function rangeTone(ds, start, end) {
  const s = parseDate(start).getTime();
  const e = parseDate(end).getTime();
  const v = parseDate(ds).getTime();
  const n = Math.round((e - s) / DAY_MS);
  const base = hexToRgb(rangeBase());
  const dark = base.map((x) => Math.round(x * 0.42));
  const light = base.map((x) => Math.round(x + (255 - x) * 0.72));
  if (n <= 0) return "rgb(" + dark.join(",") + ")";
  const i = Math.round((v - s) / DAY_MS);
  const depth = 1 - Math.abs(i / n - 0.5) * 2; // 两端 0（深），中间 1（浅）
  const c = dark.map((x, k) => Math.round(x + (light[k] - x) * depth));
  return "rgb(" + c.join(",") + ")";
}

function addTask() {
  const input = $("#task-input");
  const raw = input.value.trim();
  if (!raw) return;
  let text = raw;
  let deadline = null;
  /* 快捷语法：任务名 + 空格 + 时间（兼容全角冒号，例如“任务名 18:00”或“任务名 18：00”） */
  const m = raw.match(/^(.+?)\s+(\d{1,2})[:：](\d{2})\s*$/);
  if (m) {
    text = m[1].trim();
    const h = parseInt(m[2], 10);
    const mi = parseInt(m[3], 10);
    if (h === 24 && mi === 0) {
      /* 24:00 视为当天结束、次日 00:00 */
      const d = new Date(parseDate(cursorDate).getTime() + DAY_MS);
      d.setHours(0, 0, 0, 0);
      deadline = d.toISOString();
    } else if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) {
      deadline = hourMinOnDate(cursorDate, h, mi);
    } else {
      /* 时间非法时不拆分，保留原文本为任务名 */
      text = raw;
    }
  }
  const day = ensureDay(cursorDate);
  const order = day.tasks.reduce((max, t) => Math.max(max, t.order), -1) + 1;
  const task = {
    id: uid("t"), text: text, status: "in_progress",
    createdAt: new Date().toISOString(), deadline: deadline, completedAt: null,
    tags: [], note: "", category: selectedTaskCategory(),
    focusSeconds: 0, updatedAt: new Date().toISOString(), order: order
  };
  day.tasks.push(task);
  state.settings.lastTaskCategory = task.category;
  save();
  input.value = "";
  renderToday();
  const row = document.querySelector('[data-task="' + task.id + '"]');
  if (row) {
    row.classList.add("entering");
    setTimeout(() => row.classList.remove("entering"), 300);
  }
  toast("已添加并保存");
}

let selectedNoteTaskId = null;

function openTaskNote(id) {
  const task = findTask(id);
  if (!task) return;
  selectedNoteTaskId = id;
  $("#task-note-title").textContent = categoryLabel(task) + " · " + task.text;
  $("#task-note-input").value = task.note || "";
  $("#task-note-modal").classList.remove("hidden");
  setTimeout(() => $("#task-note-input").focus(), 0);
}

function closeTaskNote() {
  selectedNoteTaskId = null;
  $("#task-note-modal").classList.add("hidden");
}

function saveTaskNote() {
  const task = findTask(selectedNoteTaskId);
  if (!task) return closeTaskNote();
  task.note = $("#task-note-input").value.trim();
  task.updatedAt = new Date().toISOString();
  save();
  closeTaskNote();
  renderToday();
  toast(task.note ? "备注已保存" : "备注已清空");
}

function setTaskCategory(id, category) {
  const task = findTask(id);
  if (!task || !TASK_CATEGORIES[category]) return;
  task.category = category;
  task.updatedAt = new Date().toISOString();
  save();
  renderToday();
  toast("已归入" + categoryLabel(category));
}

function clearTaskNote() {
  $("#task-note-input").value = "";
  saveTaskNote();
}

function todayAllDone() {
  const tasks = dayTasks(todayStr()).filter((task) => !task.givenUp);
  return tasks.length > 0 && tasks.every((task) => task.status === "done");
}

function celebrateAllDone() {
  celebrate();
  toast("今日全部完成，留痕纪念 🎉");
}

function toggleDone(id) {
  const task = findTask(id);
  if (!task) return;
  if (task.status === "done") {
    task.status = "in_progress";
    task.completedAt = null;
  } else {
    task.status = "done";
    task.completedAt = new Date().toISOString();
  }
  save();
  renderToday();
  const row = document.querySelector('[data-task="' + id + '"]');
  if (task.status === "done" && row) {
    row.classList.add("done");
    setTimeout(() => row.classList.remove("done"), 650);
  }
  if (task.status === "done" && cursorDate === todayStr() && todayAllDone()) celebrateAllDone();
}

function cycleStatus(id) {
  const task = findTask(id);
  if (!task || task.status === "done") return;
  task.status = task.status === "in_progress" ? "pending" : "in_progress";
  save();
  renderToday();
}

function removeTask(id) {
  const task = findTask(id);
  if (!task || !window.confirm("确认删除任务“" + task.text + "”？备注也会一并删除。")) return;
  let removed = false;
  let foundDate = null;
  Object.keys(state.days).forEach((d) => {
    const before = (state.days[d].tasks || []).length;
    state.days[d].tasks = (state.days[d].tasks || []).filter((t) => t.id !== id);
    if (state.days[d].tasks.length !== before) { removed = true; if (!foundDate) foundDate = d; }
  });
  if (!removed) return;
  // 墓碑：记录删除，使云端同步（WebDAV 并集合并）能传播删除，而不是被另一端“复活”
  state.deletedTasks = state.deletedTasks || {};
  state.deletedTasks[id] = { date: foundDate, deletedAt: new Date().toISOString() };
  save();
  renderToday();
  toast("任务已删除");
}

function postpone(id) {
  const task = findTask(id);
  if (!task) return;
  task.deadline = new Date(Date.now() + 8 * 3600000).toISOString();
  task.givenUp = false;
  save();
  renderToday();
  toast("已顺延 8 小时，请尽快跟进");
}

function giveUpTask(id) {
  const task = findTask(id);
  if (!task) return;
  task.status = "pending";
  task.givenUp = true;
  save();
  renderToday();
  toast("已标记为未完成");
}

function findTask(id) {
  let hit = null;
  Object.keys(state.days).forEach((d) => {
    if (!hit) hit = (state.days[d].tasks || []).find((t) => t.id === id) || null;
  });
  return hit;
}

function renderCheckin() {
  const day = ensureDay(cursorDate);
  const btn = $("#checkin-btn");
  if (day.checkIn && day.checkIn.checked) {
    btn.textContent = "今天辛苦啦 ✓";
    btn.title = "误触了？再点一次恢复";
    btn.classList.add("checked");
  } else {
    btn.textContent = "任务完成";
    btn.title = "今天任务都完成了？点一下庆祝，误触可再点恢复";
    btn.classList.remove("checked");
  }
}

function doCheckin() {
  const day = ensureDay(cursorDate);
  if (day.checkIn && day.checkIn.checked) {
    day.checkIn = null;
    save();
    renderCheckin();
    toast("已恢复（误触了也没关系）");
    return;
  }
  day.checkIn = { checked: true, checkedAt: new Date().toISOString() };
  save();
  renderCheckin();
  const btn = $("#checkin-btn");
  btn.classList.remove("stamped");
  void btn.offsetWidth;
  btn.classList.add("stamped");
  celebrate();
  toast("今天辛苦啦");
}

/* ============ 庆祝动画：花朵 + 丝带洒落 ============ */
function celebrate() {
  const canvas = document.createElement("canvas");
  canvas.className = "confetti-canvas";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    canvas.width = Math.floor(window.innerWidth * DPR);
    canvas.height = Math.floor(window.innerHeight * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize);

  const COLORS = ["#ff6b81", "#ffb86b", "#ffd93d", "#6fcf97", "#74b9ff", "#e056fd", "#ff8a5c"];
  const FLOWER = "\u{1F338}"; // 🌸
  const parts = [];
  const total = 120;
  for (let i = 0; i < total; i++) {
    const ribbon = i % 3 !== 0; // 2/3 丝带，1/3 花朵
    const size = ribbon ? 8 + Math.random() * 10 : 14 + Math.random() * 12;
    parts.push({
      ribbon: ribbon,
      x: Math.random() * window.innerWidth,
      y: -24 - Math.random() * window.innerHeight * 0.45,
      w: size,
      h: ribbon ? 4 + Math.random() * 6 : size,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      vy: 2.2 + Math.random() * 3.4,
      vx: (Math.random() - 0.5) * 1.6,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.22,
      sway: 0.6 + Math.random() * 1.4,
      swayPhase: Math.random() * Math.PI * 2,
    });
  }

  const start = performance.now();
  const DURATION = 3200;
  const frame = (now) => {
    const t = (now - start) / DURATION;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const p of parts) {
      p.vy += 0.012;
      p.x += p.vx + Math.sin(now * 0.003 + p.swayPhase) * p.sway;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, 1 - t * 1.35);
      if (p.ribbon) {
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      } else {
        ctx.font = p.w + "px serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(FLOWER, 0, 0);
      }
      ctx.restore();
    }
    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      canvas.remove();
      window.removeEventListener("resize", resize);
    }
  };
  requestAnimationFrame(frame);
}

/* ============ 月度汇总 ============ */
let monthCursor = (function () {
  const d = new Date();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1);
})();
let monthCategoryFilter = "all";

function monthDays(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function monthTasks(ym) {
  const out = [];
  Object.keys(state.days).forEach((d) => {
    if (!d.startsWith(ym)) return;
    const tasks = dayTasks(d);
    tasks.forEach((t) => out.push(Object.assign({ date: d }, t)));
  });
  return out;
}

function overdueHours(task) {
  if (!task.deadline) return 0;
  return Math.max(1, Math.round((Date.now() - new Date(task.deadline).getTime()) / 3600000));
}

function heatLevel(rate) {
  if (rate <= 0) return 0;
  if (rate < 25) return 1;
  if (rate < 50) return 2;
  if (rate < 75) return 3;
  if (rate < 100) return 4;
  return 5;
}

function renderMonthlyHeatmaps() {
  const wrap = $("#monthly-heatmaps");
  if (!wrap) return;
  wrap.textContent = "";
  const y = Number(monthCursor.split("-")[0]);
  for (let m = 1; m <= 12; m++) {
    const ym = y + "-" + pad(m);
    const tasks = filterByCategory(monthTasks(ym), monthCategoryFilter);
    const done = tasks.filter((t) => t.status === "done").length;
    const rate = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    const block = document.createElement("div");
    block.className = "hm-month";
    const head = document.createElement("div");
    head.className = "hm-month-head";
    const label = document.createElement("span");
    label.className = "hm-month-label";
    label.textContent = m + " 月";
    const stat = document.createElement("span");
    stat.className = "hm-month-stat";
    stat.textContent = tasks.length ? done + "/" + tasks.length + " · " + rate + "%" : "无记录";
    head.append(label, stat);
    const grid = document.createElement("div");
    grid.className = "mini-heatmap hm-grid";
    const dayCount = monthDays(ym);
    for (let d = 1; d <= dayCount; d++) {
      const key = ym + "-" + pad(d);
      const day = state.days[key];
      const arr = filterByCategory(day ? day.tasks || [] : [], monthCategoryFilter);
      const dd = arr.filter((t) => t.status === "done").length;
      const focusSeconds = Math.max(0, Number(day && day.focusSeconds) || 0);
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "hm-cell lv-" + heatLevel(arr.length ? Math.round((dd / arr.length) * 100) : 0);
      if (focusSeconds > 0) cell.classList.add("has-focus");
      cell.textContent = d;
      cell.title = key + " · " + dd + "/" + arr.length + " 完成" + (focusSeconds ? " · 专注 " + formatFocusDuration(focusSeconds, true) : "");
      cell.addEventListener("click", () => {
        cursorDate = key;
        location.hash = "#today";
      });
      grid.appendChild(cell);
    }
    block.append(head, grid);
    wrap.appendChild(block);
  }
  const count = $("#monthly-heatmap-count");
  if (count) count.textContent = "12 个月 · " + (monthCategoryFilter === "all" ? "全部事务" : categoryLabel(monthCategoryFilter));
}

function buildMonthlyMD(ym) {
  const [y, m] = ym.split("-").map(Number);
  const tasks = monthTasks(ym);
  const total = tasks.length;
  const workTotal = tasks.filter((t) => taskCategory(t) === "work").length;
  const lifeTotal = tasks.filter((t) => taskCategory(t) === "life").length;
  const done = tasks.filter((t) => t.status === "done").length;
  const doing = tasks.filter((t) => t.status === "in_progress").length;
  const pending = tasks.filter((t) => t.status === "pending").length;
  const overdue = tasks.filter((t) => isOverdue(t)).length;
  let checkinDays = 0;
  let monthFocusSeconds = 0;
  Object.keys(state.days).forEach((d) => {
    if (d.startsWith(ym) && state.days[d].checkIn && state.days[d].checkIn.checked) checkinDays++;
    if (d.startsWith(ym)) monthFocusSeconds += Math.max(0, Number(state.days[d].focusSeconds) || 0);
  });
  const rate = total ? Math.round((done / total) * 100) : 0;
  const lines = [];
  lines.push("# " + y + " 年 " + m + " 月工作汇总 · 留痕");
  lines.push("");
  lines.push("## 概览");
  lines.push("");
  lines.push("| 指标 | 数值 |");
  lines.push("|---|---|");
  lines.push("| 任务总数 | " + total + " |");
  lines.push("| 工作事务 | " + workTotal + " |");
  lines.push("| 生活事务 | " + lifeTotal + " |");
  lines.push("| 已完成 | " + done + " / " + total + " |");
  lines.push("| 完成率 | " + rate + "% |");
  lines.push("| 进行中 | " + doing + " |");
  lines.push("| 未完成 | " + pending + " |");
  lines.push("| 完成天数 | " + checkinDays + " 天 |");
  lines.push("| 逾期任务 | " + overdue + " |");
  lines.push("| 专注时长 | " + formatFocusDuration(monthFocusSeconds, true) + " |");
  lines.push("");
  lines.push("## 按日明细");
  lines.push("");
  const dayCount = monthDays(ym);
  for (let d = 1; d <= dayCount; d++) {
    const key = ym + "-" + pad(d);
    const day = state.days[key];
    if (!day || ((!day.tasks || !day.tasks.length) && !Number(day.focusSeconds))) continue;
    const dd = new Date(y, m - 1, d);
    lines.push("### " + key + " 周" + "日一二三四五六"[dd.getDay()]);
    if (Number(day.focusSeconds) > 0) lines.push("- 专注 " + formatFocusDuration(day.focusSeconds, true));
    ["work", "life"].forEach((category) => {
      const categoryTasks = (day.tasks || []).filter((t) => taskCategory(t) === category).sort((a, b) => a.order - b.order);
      if (!categoryTasks.length) return;
      lines.push("#### " + categoryLabel(category));
      categoryTasks.forEach((t) => {
        const mark = t.status === "done" ? "✓" : t.status === "in_progress" ? "●" : "◌";
        const parts = [];
        if (t.deadline) parts.push("截止 " + fmtClock(t.deadline));
        if (t.tags && t.tags.length) parts.push("#" + t.tags.join(" #"));
        if (t.note) parts.push("备注：" + t.note);
        lines.push("- " + mark + " " + t.text + (parts.length ? "（" + parts.join("｜") + "）" : ""));
      });
    });
    lines.push("");
  }
  const followup = tasks.filter((t) => isOverdue(t) || t.status === "pending");
  if (followup.length) {
    lines.push("## 需跟进清单");
    lines.push("");
    followup.forEach((t) => {
      const span = isOverdue(t) ? " · 逾期 " + overdueHours(t) + " 小时" : "";
      lines.push("- 【" + categoryLabel(t) + "】" + t.text + "（" + t.date + "）" + span);
    });
    lines.push("");
  }
  lines.push("## 生成信息");
  lines.push("");
  lines.push("- 生成时间：" + fmtDateTime(new Date().toISOString()));
  lines.push("- 数据版本：trace:v1 · meta.version " + (state.meta.version || 1));
  return lines.join("\n");
}

function renderMonthly() {
  const ym = monthCursor;
  const [y, m] = ym.split("-").map(Number);
  const allMonthTasks = monthTasks(ym);
  const tasks = filterByCategory(allMonthTasks, monthCategoryFilter);
  const total = tasks.length;
  const workTotal = allMonthTasks.filter((t) => taskCategory(t) === "work").length;
  const lifeTotal = allMonthTasks.filter((t) => taskCategory(t) === "life").length;
  const done = tasks.filter((t) => t.status === "done").length;
  const doing = tasks.filter((t) => t.status === "in_progress").length;
  const pending = tasks.filter((t) => t.status === "pending").length;
  const overdue = tasks.filter((t) => isOverdue(t)).length;
  let checkinDays = 0;
  let monthFocusSeconds = 0;
  Object.keys(state.days).forEach((d) => {
    if (d.startsWith(ym) && state.days[d].checkIn && state.days[d].checkIn.checked) checkinDays++;
    if (d.startsWith(ym)) monthFocusSeconds += Math.max(0, Number(state.days[d].focusSeconds) || 0);
  });
  const rate = total ? Math.round((done / total) * 100) : 0;

  $("#month-input").value = ym;
  $$('[data-month-category-filter]').forEach((button) => {
    const category = button.dataset.monthCategoryFilter;
    button.classList.toggle("active", category === monthCategoryFilter);
    const count = filterByCategory(allMonthTasks, category).length;
    button.textContent = (category === "all" ? "全部" : categoryLabel(category)) + " " + count;
  });
  const wrap = $("#monthly-metrics");
  wrap.textContent = "";
  [
    { num: workTotal, label: "工作事务" },
    { num: lifeTotal, label: "生活事务" },
    { num: total, label: monthCategoryFilter === "all" ? "任务总数" : "当前分类" },
    { num: done + " / " + total, label: "已完成" },
    { num: (doing + pending), label: "未完成" },
    { num: rate + "%", label: "完成率" },
    { num: checkinDays + " 天", label: "完成天数" },
    { num: overdue, label: "逾期任务" },
    { num: formatFocusDuration(monthFocusSeconds, true), label: "专注时长" }
  ].forEach((it) => {
    const box = document.createElement("div");
    box.className = "metric";
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = it.num;
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = it.label;
    box.append(num, label);
    wrap.appendChild(box);
  });

  const dayCount = monthDays(ym);

  /* 12 个月热力图 */
  renderMonthlyHeatmaps();

  /* 按日明细 */
  const daysBox = $("#monthly-days");
  daysBox.textContent = "";
  let dayCountWithTasks = 0;
  for (let d = 1; d <= dayCount; d++) {
    const key = ym + "-" + pad(d);
    const day = state.days[key];
    const visibleTasks = filterByCategory(day && day.tasks ? day.tasks : [], monthCategoryFilter);
    const dayFocusSeconds = Math.max(0, Number(day && day.focusSeconds) || 0);
    if (!visibleTasks.length && !dayFocusSeconds) continue;
    dayCountWithTasks++;
    const dd = new Date(y, m - 1, d);
    const head = document.createElement("h4");
    head.className = "month-day-title";
    head.textContent = key + " 周" + "日一二三四五六"[dd.getDay()];
    daysBox.appendChild(head);
    if (dayFocusSeconds) {
      const focus = document.createElement("div");
      focus.className = "month-day-focus";
      focus.textContent = "专注 " + formatFocusDuration(dayFocusSeconds, true);
      daysBox.appendChild(focus);
    }
    ["work", "life"].forEach((category) => {
      const categoryTasks = visibleTasks.filter((t) => taskCategory(t) === category).sort((a, b) => a.order - b.order);
      if (!categoryTasks.length) return;
      const group = document.createElement("div");
      group.className = "month-category-group";
      const groupTitle = document.createElement("div");
      groupTitle.className = "month-category-title task-category-" + category;
      groupTitle.textContent = categoryLabel(category) + " · " + categoryTasks.length;
      const ul = document.createElement("ul");
      ul.className = "month-day-list";
      categoryTasks.forEach((t) => {
        const li = document.createElement("li");
        li.className = "status-" + t.status;
        const mark = t.status === "done" ? "✓" : t.status === "in_progress" ? "●" : "◌";
        const parts = [];
        if (t.deadline) parts.push("截止 " + fmtClock(t.deadline));
        if (t.tags && t.tags.length) parts.push("#" + t.tags.join(" #"));
        if (t.note) parts.push("备注：" + t.note);
        li.textContent = mark + " " + t.text + (parts.length ? "（" + parts.join("｜") + "）" : "");
        ul.appendChild(li);
      });
      group.append(groupTitle, ul);
      daysBox.appendChild(group);
    });
  }
  $("#monthly-day-count").textContent = dayCountWithTasks + " 天";
  if (!dayCountWithTasks) {
    const p = document.createElement("p");
    p.className = "empty-hint";
    p.textContent = "该月暂无任务记录。";
    daysBox.appendChild(p);
  }

  /* 需跟进清单 */
  const followup = tasks.filter((t) => isOverdue(t) || t.status === "pending");
  const fu = $("#monthly-followup");
  fu.textContent = "";
  $("#monthly-followup-count").textContent = followup.length + " 条";
  if (!followup.length) {
    const p = document.createElement("p");
    p.className = "empty-hint";
    p.textContent = "本月没有逾期或未完成任务，很好。";
    fu.appendChild(p);
  }
  followup.forEach((t) => {
    const li = document.createElement("li");
    li.className = "followup-item" + (isOverdue(t) ? " overdue" : "");
    const mark = t.status === "in_progress" ? "●" : "◌";
    const span = isOverdue(t) ? " · 已逾期 " + overdueHours(t) + " 小时 · 需跟进" : "";
    li.textContent = mark + " 【" + categoryLabel(t) + "】" + t.text + "（" + t.date + "）" + span;
    li.title = t.text;
    fu.appendChild(li);
  });

  /* 已生成月报 */
  const reports = state.monthlyReports.filter((r) => r.year === y && r.month === m);
  const rb = $("#monthly-reports");
  rb.textContent = "";
  $("#monthly-report-count").textContent = reports.length + " 份";
  if (!reports.length) {
    const p = document.createElement("p");
    p.className = "empty-hint";
    p.textContent = "还没有生成月报，点击上方「生成 Markdown」开始。";
    rb.appendChild(p);
    return;
  }
  reports.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).forEach((r) => {
    const row = document.createElement("div");
    row.className = "file-item";
    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = r.title;
    const meta = document.createElement("span");
    meta.className = "count";
    meta.textContent = fmtDateTime(r.createdAt);
    const actions = document.createElement("span");
    actions.className = "row-actions";
    const view = document.createElement("button");
    view.type = "button";
    view.className = "ghost-btn btn-sm";
    view.textContent = "预览";
    view.addEventListener("click", () => openMonthlyPreview(r.md, r.fileName));
    const down = document.createElement("button");
    down.type = "button";
    down.className = "ghost-btn btn-sm";
    down.textContent = "下载";
    down.addEventListener("click", () => downloadTextFile(r.fileName, r.md, "text/markdown"));
    actions.append(view, down);
    row.append(name, meta, actions);
    rb.appendChild(row);
  });
}

function openMonthlyPreview(md, fileName) {
  $("#monthly-preview-content").textContent = md;
  $("#monthly-preview-modal").classList.remove("hidden");
  $("#monthly-download-md").onclick = () => downloadTextFile(fileName, md, "text/markdown");
  $("#monthly-copy-md").onclick = () => {
    try { navigator.clipboard.writeText(md); toast("已复制"); }
    catch (err) { toast("复制失败", true); }
  };
  $("#monthly-preview-close").onclick = () => $("#monthly-preview-modal").classList.add("hidden");
}

function downloadTextFile(name, content, mime) {
  const blob = new Blob([content], { type: mime || "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function generateMonthlyReport() {
  const ym = monthCursor;
  const [y, m] = ym.split("-").map(Number);
  const md = buildMonthlyMD(ym);
  const fileName = ym + "-工作汇总.md";
  const now = new Date().toISOString();
  /* 重新生成默认覆盖当月旧版 */
  state.monthlyReports = state.monthlyReports.filter((r) => !(r.year === y && r.month === m));
  state.monthlyReports.push({
    id: uid("monthly"),
    year: y, month: m,
    title: y + " 年 " + m + " 月工作汇总 · 留痕",
    md, fileName, createdAt: now
  });
  /* 自动归档进文件库索引（可被全局搜索命中） */
  const fileRec = {
    id: uid("f"), name: fileName, type: "md",
    size: new Blob([md]).size, date: todayStr(),
    tags: ["月报"], path: "monthly/" + ym + "/" + fileName,
    importedAt: now
  };
  const oldIndex = state.files.findIndex((f) => f.name === fileName);
  const oldFile = oldIndex >= 0 ? state.files[oldIndex] : null;
  if (oldIndex >= 0) state.files[oldIndex] = fileRec; else state.files.push(fileRec);

  const finalize = () => {
    save();
    renderMonthly();
    openMonthlyPreview(md, fileName);
    toast("已生成 " + fileName + " 并归档进文件库");
  };

  if (REMOTE) {
    const cleanupOld = oldFile && oldFile.mode === "server"
      ? deleteServerFile(oldFile.id).catch(() => {})
      : Promise.resolve();
    cleanupOld
      .then(() => uploadServerFile(new Blob([md], { type: "text/markdown;charset=utf-8" }), fileName, todayStr(), ["月报"], now))
      .then((uploaded) => {
        if (uploaded && uploaded.id) {
          fileRec.id = uploaded.id;
          fileRec.size = uploaded.size;
          fileRec.path = "server://" + uploaded.id;
          fileRec.mode = "server";
          fileRec.status = "已存储到服务器";
        } else {
          fileRec.dataUrl = "data:text/markdown;charset=utf-8," + encodeURIComponent(md);
        }
        finalize();
      });
  } else {
    fileRec.dataUrl = "data:text/markdown;charset=utf-8," + encodeURIComponent(md);
    finalize();
  }
}

function monthlyReportHTML(ym) {
  const [y, m] = ym.split("-").map(Number);
  const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const tasks = monthTasks(ym);
  const total = tasks.length;
  const workTotal = tasks.filter((t) => taskCategory(t) === "work").length;
  const lifeTotal = tasks.filter((t) => taskCategory(t) === "life").length;
  const done = tasks.filter((t) => t.status === "done").length;
  let checkinDays = 0;
  Object.keys(state.days).forEach((d) => {
    if (d.startsWith(ym) && state.days[d].checkIn && state.days[d].checkIn.checked) checkinDays++;
  });
  const rate = total ? Math.round((done / total) * 100) : 0;
  const dayCount = monthDays(ym);
  let daysHtml = "";
  for (let d = 1; d <= dayCount; d++) {
    const key = ym + "-" + pad(d);
    const day = state.days[key];
    if (!day || !day.tasks || !day.tasks.length) continue;
    const dd = new Date(y, m - 1, d);
    let groupsHtml = "";
    ["work", "life"].forEach((category) => {
      const items = day.tasks.filter((t) => taskCategory(t) === category).sort((a, b) => a.order - b.order).map((t) => {
        const mark = t.status === "done" ? "&#10003;" : t.status === "in_progress" ? "&#9679;" : "&#9675;";
        const parts = [];
        if (t.deadline) parts.push("截止 " + fmtClock(t.deadline));
        if (t.tags && t.tags.length) parts.push("#" + t.tags.join(" #"));
        if (t.note) parts.push("备注：" + escHtml(t.note));
        return "<li>" + mark + " " + escHtml(t.text) + (parts.length ? "（" + parts.join("｜") + "）" : "") + "</li>";
      }).join("");
      if (items) groupsHtml += "<h4>" + categoryLabel(category) + "</h4><ul>" + items + "</ul>";
    });
    daysHtml += "<h3>" + key + " 周" + "日一二三四五六"[dd.getDay()] + "</h3>" + groupsHtml;
  }
  return "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>" + y + " 年 " + m + " 月工作汇总 · 留痕</title><style>"
    + "body{font-family:'PingFang SC','Microsoft YaHei UI',system-ui,sans-serif;color:#23262b;max-width:720px;margin:24px auto;padding:0 16px;line-height:1.7}"
    + "h1{font-size:22px}h2{font-size:17px;border-bottom:1px solid #e5e1d7;padding-bottom:4px}h3{font-size:14px;margin:16px 0 6px}h4{font-size:12px;color:#287c62;margin:8px 0 2px}ul{margin:4px 0 12px;padding-left:22px}li{margin:2px 0;font-size:13px}"
    + "table{border-collapse:collapse;font-size:13px}td,th{border:1px solid #d4cfc2;padding:5px 12px}@media print{body{margin:12mm auto}}"
    + "</style></head><body>"
    + "<h1>" + y + " 年 " + m + " 月工作汇总 · 留痕</h1>"
    + "<table><tr><th>任务总数</th><th>工作事务</th><th>生活事务</th><th>已完成</th><th>完成率</th><th>完成天数</th></tr>"
    + "<tr><td>" + total + "</td><td>" + workTotal + "</td><td>" + lifeTotal + "</td><td>" + done + " / " + total + "</td><td>" + rate + "%</td><td>" + checkinDays + " 天</td></tr></table>"
    + "<h2>按日明细</h2>" + (daysHtml || "<p>该月暂无任务记录。</p>")
    + "<p style=\"color:#7a7d84;font-size:12px\">生成时间：" + fmtDateTime(new Date().toISOString()) + " · 数据版本 trace:v1</p>"
    + "</body></html>";
}

function exportMonthlyPDF() {
  const ym = monthCursor;
  const html = monthlyReportHTML(ym);
  if (window.traceDesktop) {
    window.traceDesktop.printPdf({ html, defaultName: ym + "-工作汇总.pdf" }).then((r) => {
      if (r && r.ok) toast("PDF 已保存：" + r.path);
      else if (r && r.canceled) { /* 用户取消 */ }
      else toast("PDF 导出失败：" + ((r && r.error) || "未知错误"), true);
    }).catch((err) => toast("PDF 导出失败：" + err, true));
    return;
  }
  const w = window.open("", "_blank");
  if (!w) { toast("浏览器拦截了打印窗口，请允许弹窗后重试", true); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 350);
}

/* ============ 文件库 ============ */
let filesTab = "all";
let previewingFileId = null;

function fileKind(f) {
  const t = String(f.type || "").toLowerCase();
  if (t === "pdf") return "pdf";
  if (["xlsx", "xls"].includes(t)) return "sheet";
  if (["csv", "md", "txt", "json", "log"].includes(t)) return "text";
  if (["doc", "docx"].includes(t)) return "word";
  if (["ppt", "pptx"].includes(t)) return "ppt";
  if (["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(t)) return "image";
  return "other";
}

function dataUrlToText(dataUrl) {
  if (!dataUrl) return "";
  const idx = dataUrl.indexOf(",");
  if (idx < 0) return "";
  const head = dataUrl.slice(0, idx);
  const body = dataUrl.slice(idx + 1);
  if (/;base64/i.test(head)) {
    try {
      const bin = atob(body);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder("utf-8").decode(bytes);
    } catch (err) {
      return "";
    }
  }
  try { return decodeURIComponent(body); } catch (err) { return ""; }
}

function dataUrlToArrayBuffer(dataUrl) {
  const bin = atob((dataUrl || "").split(",")[1] || "");
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function decodeXml(s) {
  return String(s || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseDocxPreview(f, holder) {
  if (typeof mammoth === "undefined") {
    holder.innerHTML = '<p class="sub">Word 解析库未加载，请检查 vendor/mammoth.browser.min.js。</p>';
    return;
  }
  try {
    mammoth.convertToHtml({ arrayBuffer: dataUrlToArrayBuffer(f.dataUrl) }).then((result) => {
      holder.innerHTML = '<div class="doc-preview">' + (result.value || "<p>（空文档）</p>") + "</div>";
    }).catch((err) => {
      holder.innerHTML = '<p class="sub">Word 解析失败：' + esc(String(err)) + "</p>";
    });
  } catch (err) {
    holder.innerHTML = '<p class="sub">Word 解析失败：' + esc(String(err)) + "</p>";
  }
}

function parsePptxPreview(f, holder) {
  if (typeof JSZip === "undefined") {
    holder.innerHTML = '<p class="sub">PPT 解析库未加载，请检查 vendor/jszip.min.js。</p>';
    return;
  }
  JSZip.loadAsync(dataUrlToArrayBuffer(f.dataUrl)).then((zip) => {
    const files = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => parseInt(a.match(/(\d+)/)[1], 10) - parseInt(b.match(/(\d+)/)[1], 10));
    if (!files.length) {
      holder.innerHTML = '<p class="sub">未找到幻灯片内容（.ppt 旧格式请下载后用 PowerPoint 打开）。</p>';
      return;
    }
    return Promise.all(files.map((n) => zip.file(n).async("string"))).then((xmls) => {
      const slides = xmls.map((xml, i) => {
        const paras = [];
        xml.split("</a:p>").forEach((p) => {
          const texts = [];
          const re = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
          let m;
          while ((m = re.exec(p)) !== null) texts.push(decodeXml(m[1]));
          if (texts.join("").trim()) paras.push(texts.join(""));
        });
        return "第 " + (i + 1) + " 页\n" + paras.join("\n");
      });
      holder.innerHTML = '<div class="doc-preview"><pre>' + esc(slides.join("\n\n---\n\n")) + "</pre></div>";
    });
  }).catch((err) => {
    holder.innerHTML = '<p class="sub">PPT 解析失败：' + esc(String(err)) + "</p>";
  });
}

function fmtSize(n) {
  if (!n) return "-";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

function importFiles(fileList) {
  if (!fileList || !fileList.length) return;
  const incoming = Array.from(fileList);
  const jobs = incoming.map((file) => new Promise((resolve) => {
    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    const rec = {
      id: uid("f"),
      name: file.name,
      type: ext,
      size: file.size,
      date: todayStr(),
      tags: [],
      path: "attachments/" + todayStr().slice(0, 4) + "/" + todayStr().slice(5, 7) + "/" + file.name,
      mode: "copy",
      status: "正常",
      importedAt: new Date().toISOString()
    };
    if (REMOTE) {
      uploadServerFile(file, rec.name, rec.date, rec.tags, rec.importedAt).then((uploaded) => {
        if (uploaded && uploaded.id) {
          rec.id = uploaded.id;
          rec.type = uploaded.ext;
          rec.size = uploaded.size;
          rec.path = "server://" + uploaded.id;
          rec.mode = "server";
          rec.status = "已存储到服务器";
        } else {
          return readFileAsDataUrl(file).then((dataUrl) => {
            rec.dataUrl = dataUrl;
            rec.status = "本地临时（后端上传失败）";
          });
        }
      }).then(() => resolve(rec));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      rec.dataUrl = String(reader.result || "");
      resolve(rec);
    };
    reader.onerror = () => resolve(rec);
    reader.readAsDataURL(file);
  }));
  Promise.all(jobs).then((list) => {
    const valid = list.filter(Boolean);
    state.files = state.files.concat(valid);
    if (typeof state.meta.recordCount === "number") state.meta.recordCount += valid.length;
    save();
    renderFiles();
    toast("已导入 " + valid.length + " 个文件");
  });
}

function toggleFilePreview(id) {
  previewingFileId = previewingFileId === id ? null : id;
  renderFiles();
}

function filePreviewHtml(f) {
  const kind = fileKind(f);
  if (kind === "image" && f.dataUrl) {
    return '<div class="file-preview"><img src="' + f.dataUrl + '" alt="' + esc(f.name) + '"></div>';
  }
  if (kind === "pdf" && f.dataUrl) {
    return '<div class="file-preview"><iframe src="' + f.dataUrl + '" title="' + esc(f.name) + '"></iframe></div>';
  }
  if (kind === "text" && f.dataUrl) {
    const text = dataUrlToText(f.dataUrl);
    return '<div class="file-preview"><pre>' + esc(text.slice(0, 60000)) + "</pre></div>";
  }
  return '<div class="file-preview"><p class="sub">该类型暂不支持内置预览，可下载后使用系统软件打开。</p></div>';
}

function parseSheetPreview(f, holder) {
  if (typeof XLSX === "undefined") {
    holder.innerHTML = '<p class="sub">表格解析库未加载，请检查 vendor/xlsx.full.min.js。</p>';
    return;
  }
  try {
    const bin = atob((f.dataUrl || "").split(",")[1] || "");
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    holder.innerHTML = '<div class="table-scroll">' + XLSX.utils.sheet_to_html(ws, { header: "" }) + "</div>";
  } catch (err) {
    holder.innerHTML = '<p class="sub">表格解析失败：' + esc(String(err)) + "</p>";
  }
}

function renderFiles() {
  const list = $("#file-list");
  list.textContent = "";
  let files = state.files.slice();
  if (filesTab === "sheet") files = files.filter((f) => fileKind(f) === "sheet");
  if (filesTab === "pdf") files = files.filter((f) => fileKind(f) === "pdf");
  if (filesTab === "other") files = files.filter((f) => !["sheet", "pdf"].includes(fileKind(f)));
  files.sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt)));
  $$("#files-tabs .wb-switch-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.filesTab === filesTab);
  });
  $("#file-count").textContent = files.length + " 个";
  if (!state.files.length) {
    const p = document.createElement("p");
    p.className = "empty-hint";
    p.textContent = "还没有文件，拖拽或点击上方区域导入。";
    list.appendChild(p);
    return;
  }
  if (!files.length) {
    const p = document.createElement("p");
    p.className = "empty-hint";
    p.textContent = "该分类下暂无文件。";
    list.appendChild(p);
    return;
  }
  files.forEach((f) => {
    const row = document.createElement("div");
    row.className = "file-item";
    row.dataset.id = f.id;
    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = f.name;
    const meta = document.createElement("span");
    meta.className = "count";
    meta.textContent = f.date + " · " + fmtSize(f.size) + " · " + String(f.type).toUpperCase();
    const tags = document.createElement("span");
    tags.className = "file-tags";
    (f.tags || []).forEach((t) => {
      const tag = document.createElement("span");
      tag.className = "file-tag";
      tag.textContent = "#" + t;
      tags.appendChild(tag);
    });
    const actions = document.createElement("span");
    actions.className = "row-actions";
    const preview = document.createElement("button");
    preview.type = "button";
    preview.className = "ghost-btn btn-sm";
    preview.textContent = previewingFileId === f.id ? "收起" : "预览";
    preview.addEventListener("click", () => toggleFilePreview(f.id));
    const tagBtn = document.createElement("button");
    tagBtn.type = "button";
    tagBtn.className = "ghost-btn btn-sm";
    tagBtn.textContent = "标签";
    tagBtn.addEventListener("click", () => {
      const input = window.prompt("输入标签（用空格或逗号分隔）：", (f.tags || []).join(" "));
      if (input === null) return;
      f.tags = input.split(/[\s,，]+/).map((s) => s.trim()).filter(Boolean);
      save();
      renderFiles();
    });
    const download = document.createElement("button");
    download.type = "button";
    download.className = "ghost-btn btn-sm";
    download.textContent = "下载";
    download.addEventListener("click", () => {
      if (f.mode === "server") {
        if (DESKTOP) {
          fetchFileDataUrl(f.id).then((dataUrl) => {
            if (!dataUrl) { toast("下载失败：无法读取文件", true); return; }
            const a = document.createElement("a");
            a.href = dataUrl;
            a.download = f.name;
            a.click();
          });
          return;
        }
        const a = document.createElement("a");
        a.href = "/api/files/" + encodeURIComponent(f.id);
        a.download = f.name;
        a.click();
        return;
      }
      if (!f.dataUrl) { toast("仅索引模式无法下载，请在 Electron 版中定位原文件", true); return; }
      const a = document.createElement("a");
      a.href = f.dataUrl;
      a.download = f.name;
      a.click();
    });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "ghost-btn btn-sm";
    del.textContent = "删除";
    del.addEventListener("click", () => {
      if (!window.confirm("删除文件记录「" + f.name + "」？")) return;
      (async () => {
        if (f.mode === "server") {
          try { await deleteServerFile(f.id); }
          catch (err) { toast("删除失败：" + err.message, true); return; }
        }
        state.files = state.files.filter((x) => x.id !== f.id);
        if (previewingFileId === f.id) previewingFileId = null;
        save();
        renderFiles();
      })();
    });
    actions.append(preview, tagBtn, download, del);
    row.append(name, meta, tags, actions);
    if (f.mode === "index") {
      const note = document.createElement("span");
      note.className = "file-missing";
      note.textContent = "仅索引";
      row.appendChild(note);
    }
    list.appendChild(row);
    if (previewingFileId === f.id) {
      const kind = fileKind(f);
      const holder = document.createElement("div");
      holder.className = "file-preview";
      holder.innerHTML = '<p class="sub">正在加载…</p>';
      list.appendChild(holder);
      const renderPreview = () => {
        if (f.dataUrl && ["sheet", "word", "ppt"].includes(kind)) {
          holder.innerHTML = '<p class="sub">正在解析…</p>';
          if (kind === "sheet") parseSheetPreview(f, holder);
          if (kind === "word") parseDocxPreview(f, holder);
          if (kind === "ppt") parsePptxPreview(f, holder);
        } else {
          holder.innerHTML = filePreviewHtml(f);
        }
      };
      if (f.mode === "server") {
        fetchFileDataUrl(f.id).then((dataUrl) => {
          if (!dataUrl) {
            holder.innerHTML = '<p class="sub">预览加载失败，可下载后用系统软件打开。</p>';
            return;
          }
          f.dataUrl = dataUrl;
          renderPreview();
        });
      } else {
        renderPreview();
      }
    }
  });
}

/* ============ 全局搜索 ============ */
let searchTimer = null;

function searchAll(q) {
  if (!q) return { tasks: [], files: [], reports: [] };
  const lq = q.toLowerCase();
  const hit = (s) => String(s || "").toLowerCase().includes(lq);
  const tasks = [];
  Object.keys(state.days).forEach((d) => {
    (state.days[d].tasks || []).forEach((t) => {
      const hay = [t.text, (t.tags || []).join(" "), t.note, d].join(" ");
      if (hit(hay)) tasks.push({ date: d, task: t });
    });
  });
  const files = state.files.filter((f) => hit([f.name, f.date, (f.tags || []).join(" ")].join(" ")));
  const reports = state.monthlyReports.filter((r) => hit([r.title, r.md].join(" ")));
  return {
    tasks: tasks.slice(0, 15),
    files: files.slice(0, 15),
    reports: reports.slice(0, 10)
  };
}

function renderSearchResults() {
  const box = $("#search-results");
  const q = $("#search-input").value.trim();
  if (!q) { box.classList.add("hidden"); return; }
  const res = searchAll(q);
  if (!res.tasks.length && !res.files.length && !res.reports.length) {
    box.innerHTML = '<div class="search-empty">没有找到相关内容</div>';
    box.classList.remove("hidden");
    return;
  }
  let html = "";
  if (res.tasks.length) {
    html += '<div class="search-group-title">当日记录（' + res.tasks.length + "）</div>";
    html += res.tasks.map((t) =>
      '<button type="button" class="search-item" onclick="goSearchTask(\'' + t.task.id + "','" + t.date + "')\"><b>" + esc(t.task.text) + "</b><span>" + t.date + " · " + t.task.status + "</span></button>"
    ).join("");
  }
  if (res.files.length) {
    html += '<div class="search-group-title">文件（' + res.files.length + "）</div>";
    html += res.files.map((f) =>
      '<button type="button" class="search-item" onclick="goSearchFile(\'' + f.id + "')\"><b>" + esc(f.name) + "</b><span>" + f.date + " · " + String(f.type).toUpperCase() + "</span></button>"
    ).join("");
  }
  if (res.reports.length) {
    html += '<div class="search-group-title">月报（' + res.reports.length + "）</div>";
    html += res.reports.map((r) =>
      '<button type="button" class="search-item" onclick="goSearchReport(\'' + r.id + "')\"><b>" + esc(r.title) + "</b><span>Markdown 月报</span></button>"
    ).join("");
  }
  box.innerHTML = html;
  box.classList.remove("hidden");
}

function hideSearchResults() {
  $("#search-results").classList.add("hidden");
}

function highlightBySelector(sel) {
  const el = document.querySelector(sel);
  if (el) {
    el.classList.add("search-hit");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => el.classList.remove("search-hit"), 2600);
  }
}

function goSearchTask(id, date) {
  $("#search-input").value = "";
  hideSearchResults();
  cursorDate = date;
  if (currentView() !== "today") location.hash = "#today";
  renderRoute();
  setTimeout(() => highlightBySelector('[data-task="' + id + '"]'), 80);
}

function goSearchFile(id) {
  $("#search-input").value = "";
  hideSearchResults();
  if (currentView() !== "files") location.hash = "#files";
  renderRoute();
  setTimeout(() => highlightBySelector('[data-id="' + id + '"]'), 80);
}

function goSearchReport(id) {
  const r = state.monthlyReports.find((x) => x.id === id);
  $("#search-input").value = "";
  hideSearchResults();
  if (r) monthCursor = r.year + "-" + pad(r.month);
  if (currentView() !== "monthly") location.hash = "#monthly";
  renderRoute();
  setTimeout(() => highlightBySelector('[data-id="' + id + '"]'), 80);
}

/* ============ 记账（复刻自 90 天计划项目） ============ */
let financeInitialized = false;
let financeDetailDate = null;

function financeItems() {
  return (state.finance && state.finance.items) || [];
}

function financeItemsFor(date) {
  return financeItems().filter((it) => it.date === date);
}

function financeTotal(items) {
  return items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
}

function heatLevel(percent) {
  if (percent <= 0) return 0;
  if (percent < 25) return 1;
  if (percent < 50) return 2;
  if (percent < 75) return 3;
  if (percent < 100) return 4;
  return 5;
}

function financeMonthlySummary(year) {
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const dim = new Date(year, m, 0).getDate();
    const days = [];
    let monthTotal = 0;
    for (let d = 1; d <= dim; d++) {
      const date = year + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      if (date > todayStr()) continue;
      const items = financeItemsFor(date);
      const total = financeTotal(items);
      monthTotal += total;
      days.push({ date, total: Math.round(total * 100) / 100, items });
    }
    months.push({ month: m, label: m + " 月", days, total: Math.round(monthTotal * 100) / 100 });
  }
  return months;
}

function renderFinance() {
  const date = todayStr();
  $("#finance-date").textContent = date;
  const items = financeItemsFor(date);
  const list = $("#finance-items");
  list.textContent = "";
  const max = Math.max(1, ...items.map((it) => Number(it.amount) || 0));
  items.forEach((item, index) => {
    const row = document.createElement("li");
    row.className = "finance-row" + (index === items.length - 1 ? " entering" : "");
    const info = document.createElement("div");
    info.className = "finance-info";
    const name = document.createElement("span");
    name.className = "finance-name";
    name.textContent = item.name;
    info.appendChild(name);
    if (item.note) {
      const note = document.createElement("span");
      note.className = "finance-note";
      note.textContent = item.note;
      info.appendChild(note);
    }
    const track = document.createElement("div");
    track.className = "finance-bar";
    const ratio = max > 0 ? Math.round((Number(item.amount) / max) * 100) : 0;
    track.title = item.name + " · " + item.amount + " 元" + (item.note ? " · " + item.note : "");
    const fill = document.createElement("span");
    fill.className = "finance-fill lv-" + Math.max(1, heatLevel(ratio));
    fill.style.width = ratio + "%";
    track.appendChild(fill);
    const amount = document.createElement("span");
    amount.className = "finance-amount";
    amount.textContent = "¥" + item.amount;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "finance-del";
    del.textContent = "✕";
    del.title = "删除这笔消费";
    del.setAttribute("aria-label", "删除 " + item.name + " " + item.amount + " 元");
    del.addEventListener("click", () => removeFinanceItem(item.id));
    row.append(info, track, amount, del);
    list.appendChild(row);
  });
  $("#finance-total").textContent = "合计 " + financeTotal(items).toFixed(2) + " 元";
  $("#finance-count").textContent = items.length + " 笔";
}

function renderFinanceDayDetail(date) {
  financeDetailDate = date;
  const items = financeItemsFor(date);
  $("#finance-day-detail-title").textContent = date + " · 共消费 " + financeTotal(items).toFixed(2) + " 元";
  const list = $("#finance-day-detail-list");
  list.textContent = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "detail-item";
    const text = document.createElement("span");
    text.className = "detail-text";
    text.textContent = "这天没有消费记录";
    li.appendChild(text);
    list.appendChild(li);
    return;
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    li.className = "detail-item";
    const mark = document.createElement("span");
    mark.className = "detail-mark done";
    mark.textContent = "¥";
    const text = document.createElement("span");
    text.className = "detail-text";
    text.textContent = item.name + " · " + item.amount + " 元" + (item.note ? "（" + item.note + "）" : "");
    li.append(mark, text);
    list.appendChild(li);
  });
}

function renderFinanceMonths(year) {
  const months = financeMonthlySummary(year);
  const grid = $("#finance-month-grid");
  grid.textContent = "";
  const allDays = months.flatMap((month) => month.days);
  const maxTotal = Math.max(1, ...allDays.map((day) => day.total || 0));
  months.forEach((month) => {
    const card = document.createElement("div");
    card.className = "month-card";
    const head = document.createElement("div");
    head.className = "month-head";
    const strong = document.createElement("strong");
    strong.textContent = month.label;
    const span = document.createElement("span");
    span.textContent = "共消费 " + month.total + " 元";
    head.append(strong, span);
    const weekdays = document.createElement("div");
    weekdays.className = "month-weekdays";
    ["一", "二", "三", "四", "五", "六", "日"].forEach((wd) => {
      const s = document.createElement("span");
      s.textContent = wd;
      weekdays.appendChild(s);
    });
    const heat = document.createElement("div");
    heat.className = "month-heat";
    month.days.forEach((day) => {
      const ratio = maxTotal > 0 ? Math.round(((day.total || 0) / maxTotal) * 100) : 0;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "day-cell lv-" + heatLevel(ratio) + (financeDetailDate === day.date ? " selected" : "");
      btn.style.gridColumnStart = (new Date(day.date + "T00:00:00").getDay() + 6) % 7 + 1;
      btn.title = day.date + " · " + day.total + " 元";
      btn.setAttribute("aria-label", btn.title);
      btn.addEventListener("click", () => {
        grid.querySelectorAll(".day-cell").forEach((cell) => cell.classList.remove("selected"));
        btn.classList.add("selected");
        renderFinanceDayDetail(day.date);
      });
      heat.appendChild(btn);
    });
    card.append(head, weekdays, heat);
    grid.appendChild(card);
  });
}

function refreshFinanceMonths() {
  const select = $("#finance-year");
  if (select) renderFinanceMonths(parseInt(select.value, 10) || new Date().getFullYear());
}

function removeFinanceItem(id) {
  const items = financeItems();
  const idx = items.findIndex((it) => it.id === id);
  if (idx < 0) return;
  items.splice(idx, 1);
  save();
  renderFinance();
  refreshFinanceMonths();
  toast("已删除");
}

function renderFinanceRoute() {
  if (!financeInitialized) {
    financeInitialized = true;
    const select = $("#finance-year");
    const startYear = Math.min(new Date().getFullYear(), parseInt((state.meta.createdAt || "").slice(0, 4), 10) || new Date().getFullYear());
    const currentYear = new Date().getFullYear();
    select.textContent = "";
    for (let y = currentYear; y >= startYear; y--) {
      const option = document.createElement("option");
      option.value = y;
      option.textContent = y + " 年";
      select.appendChild(option);
    }
    select.value = String(currentYear);
    select.addEventListener("change", () => renderFinanceMonths(parseInt(select.value, 10)));
    $("#finance-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const name = $("#finance-name").value.trim();
      const amount = Number($("#finance-amount").value);
      if (!name || !(amount > 0)) {
        toast("请填写消费名称和有效金额", true);
        return;
      }
      financeItems().push({
        id: uid("f"),
        name: name,
        amount: Math.round(amount * 100) / 100,
        note: $("#finance-note").value.trim(),
        date: todayStr(),
        createdAt: new Date().toISOString()
      });
      save();
      $("#finance-name").value = "";
      $("#finance-amount").value = "";
      $("#finance-note").value = "";
      $("#finance-name").focus();
      renderFinance();
      refreshFinanceMonths();
      toast("已添加");
    });
  }
  renderFinance();
  refreshFinanceMonths();
  if (financeDetailDate) renderFinanceDayDetail(financeDetailDate);
}

/* ============ 备份与恢复 ============ */
function renderBackup() {
  let snap = null;
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (raw) snap = JSON.parse(raw);
  } catch (err) {}
  $("#snapshot-info").textContent = snap
    ? "最近快照：" + fmtDateTime(snap.at) + "（快照用于导入前与损坏恢复）"
    : "暂无快照";
  const size = new Blob([JSON.stringify(state)]).size;
  $("#storage-info").textContent = "当前数据量约 " + (size / 1024).toFixed(1) + " KB · 任务 " + countRecords() + " 条" +
    (REMOTE ? " · 数据已写入统一数据库" : "");
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  a.download = "留痕备份-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" +
    pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + ".json";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
  toast("备份已导出");
}

let pendingImport = null;

function readImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !data.meta || !data.days) throw new Error("不是有效的留痕备份文件");
      pendingImport = normalize(data);
      const dayKeys = Object.keys(pendingImport.days);
      $("#import-preview").textContent =
        "记录数 " + pendingImport.meta.recordCount + " · 覆盖 " + dayKeys.length + " 天 · 文件 " + pendingImport.files.length + " 个" +
        (dayKeys.length ? " · 日期范围 " + dayKeys[0] + " ~ " + dayKeys[dayKeys.length - 1] : "");
      $("#import-modal").classList.remove("hidden");
    } catch (err) {
      toast("导入失败：" + err.message, true);
    }
  };
  reader.readAsText(file);
}

function applyImport(mode) {
  if (!pendingImport) return;
  takeSnapshot();
  if (mode === "replace") {
    state = pendingImport;
  } else {
    Object.keys(pendingImport.days).forEach((d) => {
      state.days[d] = pendingImport.days[d];
    });
    const ids = new Set(state.files.map((f) => f.id));
    pendingImport.files.forEach((f) => {
      if (!ids.has(f.id)) state.files.push(f);
    });
  }
  pendingImport = null;
  save(mode === "replace");
  $("#import-modal").classList.add("hidden");
  renderRoute();
  toast(mode === "replace" ? "已替换全部数据" : "已合并导入");
}

/* ============ 设置 ============ */
function renderSettings() {
  $("#theme-select").value = state.settings.style || "paper";
  $("#threshold-input").value = state.settings.gradientThresholdMin;
  $("#reminder-toggle").checked = !!state.settings.backupReminderEnabled;
  $("#pomodoro-toggle").checked = state.settings.pomodoroEnabled !== false;
}

function clearDemo() {
  const keep = state.settings;
  state = emptyState();
  state.settings = keep;
  save(true);
  renderRoute();
  toast("演示数据已清空");
}

function restoreDemo() {
  state = demoState();
  save(true);
  renderRoute();
  toast("演示数据已恢复");
}

/* ============ 事件绑定 ============ */
function bind() {
  window.addEventListener("hashchange", renderRoute);

  const winMinimize = $("#win-minimize");
  const winMaximize = $("#win-maximize");
  const winClose = $("#win-close");
  if (winMinimize && window.traceDesktop && window.traceDesktop.minimizeWindow) {
    winMinimize.addEventListener("click", () => window.traceDesktop.minimizeWindow());
  }
  if (winMaximize && window.traceDesktop && window.traceDesktop.toggleMaximize) {
    winMaximize.addEventListener("click", () => window.traceDesktop.toggleMaximize());
  }
  if (winClose && window.traceDesktop && window.traceDesktop.closeWindow) {
    winClose.addEventListener("click", () => window.traceDesktop.closeWindow());
  }

  $("#add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    addTask();
  });
  $$('[data-task-category-filter]').forEach((button) => {
    button.addEventListener("click", () => {
      todayCategoryFilter = button.dataset.taskCategoryFilter;
      renderToday();
    });
  });
  $$('[data-task-category]').forEach((button) => {
    button.addEventListener("click", () => {
      state.settings.lastTaskCategory = TASK_CATEGORIES[button.dataset.taskCategory] ? button.dataset.taskCategory : "work";
      save();
      renderTaskCategoryPicker(dayTasks(cursorDate));
      $("#task-input").focus();
    });
    button.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const next = button.dataset.taskCategory === "work" ? "life" : "work";
      const target = document.querySelector('[data-task-category="' + next + '"]');
      if (target) target.click();
    });
  });

  const floatingToggle = $("#floating-toggle");
  if (floatingToggle) {
    if (!DESKTOP) floatingToggle.classList.add("hidden");
    else floatingToggle.addEventListener("click", async () => {
      const result = await window.traceDesktop.toggleFloating();
      renderFloatingToggle(result && result.visible);
    });
  }
  $("#task-note-save").addEventListener("click", saveTaskNote);
  $("#task-note-clear").addEventListener("click", clearTaskNote);
  $("#task-note-cancel").addEventListener("click", closeTaskNote);
  $("#task-note-modal").addEventListener("click", (e) => {
    if (e.target.id === "task-note-modal") closeTaskNote();
  });
  $("#focus-pause").addEventListener("click", toggleFocusPause);
  $("#focus-stop").addEventListener("click", () => finishFocus(false));
  $("#focus-cancel").addEventListener("click", () => finishFocus(true));

  $("#checkin-btn").addEventListener("click", doCheckin);
  $("#prev-day").addEventListener("click", () => {
    cursorDate = dateStr(new Date(parseDate(cursorDate).getTime() - DAY_MS));
    renderToday();
  });
  $("#next-day").addEventListener("click", () => {
    cursorDate = dateStr(new Date(parseDate(cursorDate).getTime() + DAY_MS));
    renderToday();
  });
  $("#today-btn").addEventListener("click", () => {
    cursorDate = todayStr();
    renderToday();
  });

  $("#export-btn").addEventListener("click", exportBackup);
  $("#month-input").addEventListener("change", (e) => {
    if (e.target.value) { monthCursor = e.target.value; renderMonthly(); }
  });
  $("#month-today-btn").addEventListener("click", () => {
    const d = new Date();
    monthCursor = d.getFullYear() + "-" + pad(d.getMonth() + 1);
    renderMonthly();
  });
  $$('[data-month-category-filter]').forEach((button) => {
    button.addEventListener("click", () => {
      monthCategoryFilter = button.dataset.monthCategoryFilter;
      renderMonthly();
    });
  });
  $("#monthly-gen-md").addEventListener("click", generateMonthlyReport);
  $("#monthly-export-pdf").addEventListener("click", exportMonthlyPDF);
  $("#search-input").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderSearchResults, 200);
  });
  $("#search-input").addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideSearchResults();
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#global-search")) hideSearchResults();
  });
  $("#file-dropzone").addEventListener("click", () => $("#file-input").click());
  ["dragenter", "dragover"].forEach((ev) => {
    $("#file-dropzone").addEventListener(ev, (e) => {
      e.preventDefault();
      $("#file-dropzone").classList.add("drag");
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    $("#file-dropzone").addEventListener(ev, (e) => {
      e.preventDefault();
      $("#file-dropzone").classList.remove("drag");
    });
  });
  $("#file-dropzone").addEventListener("drop", (e) => {
    if (e.dataTransfer && e.dataTransfer.files) importFiles(e.dataTransfer.files);
  });
  $("#file-input").addEventListener("change", (e) => {
    if (e.target.files) importFiles(e.target.files);
    e.target.value = "";
  });
  $$("#files-tabs .wb-switch-tab").forEach((b) => {
    b.addEventListener("click", () => {
      filesTab = b.dataset.filesTab;
      previewingFileId = null;
      renderFiles();
    });
  });
  $("#import-btn").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) readImportFile(e.target.files[0]);
    e.target.value = "";
  });
  $("#import-merge").addEventListener("click", () => applyImport("merge"));
  $("#import-replace").addEventListener("click", () => applyImport("replace"));
  $("#import-cancel").addEventListener("click", () => {
    pendingImport = null;
    $("#import-modal").classList.add("hidden");
  });

  $("#corrupt-snapshot").addEventListener("click", () => {
    try {
      const raw = localStorage.getItem(SNAPSHOT_KEY);
      if (!raw) throw new Error("没有可用快照");
      const snap = JSON.parse(raw);
      state = normalize(snap.data);
      save();
      $("#corrupt-modal").classList.add("hidden");
      renderRoute();
      toast("已从快照恢复");
    } catch (err) {
      toast("快照恢复失败：" + err.message, true);
    }
  });
  $("#corrupt-import").addEventListener("click", () => {
    $("#corrupt-modal").classList.add("hidden");
    $("#import-file").click();
  });
  $("#corrupt-reset").addEventListener("click", () => {
    state = demoState();
    save();
    $("#corrupt-modal").classList.add("hidden");
    renderRoute();
    toast("已重建数据（含演示数据）");
  });

  $("#theme-select").addEventListener("change", (e) => {
    state.settings.style = e.target.value;
    applyTheme(e.target.value);
    save();
  });
  $("#threshold-input").addEventListener("change", (e) => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v) && v > 0) {
      state.settings.gradientThresholdMin = v;
      save();
      renderToday();
    }
  });
  $("#reminder-toggle").addEventListener("change", (e) => {
    state.settings.backupReminderEnabled = e.target.checked;
    save();
  });
  $("#pomodoro-toggle").addEventListener("change", (e) => {
    state.settings.pomodoroEnabled = e.target.checked;
    save();
    renderRoute();
  });
  $("#clear-demo-btn").addEventListener("click", clearDemo);
  $("#restore-demo-btn").addEventListener("click", restoreDemo);
}

function renderFloatingToggle(visible) {
  const button = $("#floating-toggle");
  const stateLabel = $("#floating-toggle-state");
  if (!button || !stateLabel) return;
  button.setAttribute("aria-pressed", String(!!visible));
  stateLabel.textContent = visible ? "显示中" : "已隐藏";
}

function bindDesktopTaskSync() {
  if (!DESKTOP) return;
  window.traceDesktop.getFloatingState().then((result) => renderFloatingToggle(result && result.visible));
  window.traceDesktop.onFloatingVisibility((result) => renderFloatingToggle(result && result.visible));
  let refreshTimer = null;
  window.traceDesktop.onTaskStateChanged(() => {
    const wasAllDone = todayAllDone();
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      const remote = await apiGetState();
      if (!remote || !remote.meta || !remote.days) return;
      state = normalize(remote);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (err) { /* 仅缓存 */ }
      renderRoute();
      if (!wasAllDone && todayAllDone()) celebrateAllDone();
    }, 80);
  });
  window.traceDesktop.onFocusStateChanged((next) => {
    activeFocusSession = next && next.active || null;
    if (!activeFocusSession) closeFocusModal();
    else if (focusModalOpen) updateFocusModal();
    if (currentView() === "today") renderToday();
  });
  window.traceDesktop.focusGetState().then((next) => {
    activeFocusSession = next && next.active || null;
    if (currentView() === "today") renderToday();
  });
}

/* ============ 启动 ============ */
(async function boot() {
  await load();
  if (state) {
    applyTheme(state.settings.style || "paper");
    bind();
    bindDesktopTaskSync();
    renderRoute();
  } else {
    /* 数据损坏时仅绑定恢复向导，等用户选择后再进入主流程 */
    applyTheme("paper");
    bind();
  }
})();
