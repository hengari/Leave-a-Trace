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

/* ============ 存储层（输入即存，单出口） ============ */
let state = null;

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
    settings: {
      gradientThresholdMin: 60,
      style: "paper",
      backupReminderEnabled: true
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
        deadline: todayDeadline.toISOString(), completedAt: null, tags: ["方案"], note: "含热力图对标", order: 0
      },
      {
        id: uid("t"), text: "晨会纪要", status: "done",
        createdAt: new Date(now.getTime() - 5 * 3600000).toISOString(),
        deadline: null, completedAt: new Date(now.getTime() - 4 * 3600000).toISOString(), tags: [], note: "", order: 1
      },
      {
        id: uid("t"), text: "回复客户邮件", status: "pending",
        createdAt: new Date(now.getTime() - 6 * 3600000).toISOString(),
        deadline: yesterdayOverdue.toISOString(), completedAt: null, tags: ["客户"], note: "", order: 2
      },
      {
        id: uid("t"), text: "整理本周报表", status: "in_progress",
        createdAt: new Date(now.getTime() - 1 * 3600000).toISOString(),
        deadline: nearDeadline.toISOString(), completedAt: null, tags: [], note: "", order: 3
      }
    ],
    checkIn: null
  };
  st.days[d1] = {
    tasks: [
      {
        id: uid("t"), text: "周报撰写", status: "done",
        createdAt: new Date(now.getTime() - DAY_MS - 3 * 3600000).toISOString(),
        deadline: null, completedAt: new Date(now.getTime() - DAY_MS - 1 * 3600000).toISOString(), tags: [], note: "", order: 0
      },
      {
        id: uid("t"), text: "需求评审", status: "done",
        createdAt: new Date(now.getTime() - DAY_MS - 5 * 3600000).toISOString(),
        deadline: null, completedAt: new Date(now.getTime() - DAY_MS - 2 * 3600000).toISOString(), tags: [], note: "", order: 1
      }
    ],
    checkIn: { checked: true, checkedAt: new Date(now.getTime() - DAY_MS - 3 * 3600000).toISOString() }
  };
  st.days[d2] = {
    tasks: [
      {
        id: uid("t"), text: "阅读《深度工作》第 3 章", status: "done",
        createdAt: new Date(now.getTime() - 2 * DAY_MS - 4 * 3600000).toISOString(),
        deadline: null, completedAt: new Date(now.getTime() - 2 * DAY_MS - 2 * 3600000).toISOString(), tags: [], note: "", order: 0
      },
      {
        id: uid("t"), text: "整理读书笔记", status: "pending",
        createdAt: new Date(now.getTime() - 2 * DAY_MS - 2 * 3600000).toISOString(),
        deadline: null, completedAt: null, tags: [], note: "", order: 1
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
  st.settings.style = savedStyle;
  return st;
}

function save() {
  const count = countRecords();
  const hint = state.meta.nextBackupHintAt;
  if (state.settings.backupReminderEnabled && hint > 0 && count >= hint) {
    state.meta.nextBackupHintAt = hint + 20;
    setTimeout(() => toast("已累计 " + count + " 条记录，建议导出备份", true), 400);
  }
  state.meta.recordCount = count;
  state.meta.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    toast("保存失败：数据未落盘，请检查磁盘空间", true);
  }
  scheduleServerSave();
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
function scheduleServerSave() {
  if (!REMOTE) return;
  clearTimeout(serverSaveTimer);
  serverSaveTimer = setTimeout(() => {
    if (DESKTOP) {
      window.traceDesktop.putState(state).catch(() => toast("保存失败：数据未写入数据库", true));
    } else {
      fetch("/api/state", {
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
  document.documentElement.dataset.theme = style;
  $("#theme-toggle").textContent = style === "dark" ? "☀" : "☾";
  const sel = $("#theme-select");
  if (sel) sel.value = style;
  try { localStorage.setItem("trace:style", style); } catch (err) {}
}

/* ============ 路由 ============ */
function currentView() {
  const h = location.hash.replace("#", "");
  return ["today", "monthly", "files", "backup", "settings", "workbench"].indexOf(h) >= 0 ? h : "today";
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
}

/* ============ 今日页 ============ */
let cursorDate = todayStr();

function dayTasks(date) {
  const d = state.days[date];
  return d ? d.tasks : [];
}

function ensureDay(date) {
  if (!state.days[date]) state.days[date] = { tasks: [], checkIn: null };
  return state.days[date];
}

function isOverdue(task) {
  return task.status !== "done" && task.deadline && new Date(task.deadline).getTime() < Date.now() && !task.givenUp;
}

function renderToday() {
  const d = parseDate(cursorDate);
  $("#day-title").textContent = (d.getMonth() + 1) + "月" + d.getDate() + "日 星期" + weekdayCN(d);
  $("#day-sub").textContent = (cursorDate === todayStr() ? "今天" : "历史记录") + " · " + dayTasks(cursorDate).length + " 项任务";

  $("#write-banner").classList.toggle("hidden", cursorDate === todayStr());
  $("#today-btn").classList.toggle("hidden", cursorDate === todayStr());

  const tasks = dayTasks(cursorDate).slice().sort((a, b) => a.order - b.order);
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
  if (interactive) status.addEventListener("click", () => cycleStatus(task.id));

  const check = document.createElement("button");
  check.type = "button";
  check.className = "task-check" + (task.status === "done" ? " done" : "");
  check.title = task.status === "done" ? "取消完成" : "标记完成";
  check.innerHTML = '<svg viewBox="0 0 12 12"><path d="M2 6.5 5 9.5 10 2.5"/></svg>';
  if (interactive) check.addEventListener("click", () => toggleDone(task.id));
  else check.disabled = true;

  const main = document.createElement("div");
  main.className = "task-main";

  const text = document.createElement("span");
  text.className = "task-text";
  text.textContent = task.text;
  main.appendChild(text);

  const meta = document.createElement("div");
  meta.className = "task-meta";
  if (task.tags && task.tags.length) {
    const tag = document.createElement("span");
    tag.textContent = "#" + task.tags.join(" #");
    meta.appendChild(tag);
  }
  if (task.note) {
    const note = document.createElement("span");
    note.textContent = task.note;
    meta.appendChild(note);
  }

  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "deadline-chip";
  updateChip(chip, task);
  if (interactive) {
    /* 悬浮即出现时间编辑框；触屏/点击同样可编辑 */
    chip.addEventListener("mouseenter", () => openChipEditor(chip, task));
    chip.addEventListener("click", () => openChipEditor(chip, task));
  }
  else chip.disabled = true;
  meta.appendChild(chip);
  main.appendChild(meta);

  if (task.deadline && task.status !== "done" && !isOverdue(task)) {
    const timer = document.createElement("div");
    timer.className = "task-timer";
    const fill = document.createElement("span");
    const total = Math.max(new Date(task.deadline) - new Date(task.createdAt), 3600000);
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
      later.addEventListener("click", () => postpone(task.id));
      actions.appendChild(later);
      const giveUp = document.createElement("button");
      giveUp.textContent = "放弃";
      giveUp.title = "标记为未完成（归档）";
      giveUp.addEventListener("click", () => giveUpTask(task.id));
      actions.appendChild(giveUp);
    }
    const del = document.createElement("button");
    del.textContent = "删除";
    del.className = "danger";
    del.addEventListener("click", () => removeTask(task.id));
    actions.appendChild(del);
    li.append(status, check, main, actions);
  } else {
    li.append(status, check, main);
  }
  return li;
}

function updateChip(chip, task) {
  chip.className = "deadline-chip";
  if (task.deadline) {
    const dl = new Date(task.deadline);
    const sameDay = dateStr(dl) === cursorDate;
    const over = isOverdue(task);
    const near = !over && task.status !== "done" && dl.getTime() - Date.now() < state.settings.gradientThresholdMin * 60000;
    if (over) chip.classList.add("overdue");
    else if (near) chip.classList.add("near");
    const label = over
      ? "已逾期 " + Math.max(1, Math.round((Date.now() - dl.getTime()) / 3600000)) + " 小时"
      : (sameDay ? "截止 " + fmtClock(task.deadline) : "截止 " + fmtDateTime(task.deadline));
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

function openChipEditor(chip, task) {
  if (chip._editing) return;
  chip._editing = true;
  const input = document.createElement("input");
  input.type = "datetime-local";
  input.className = "chip-edit-input";
  if (task.deadline) {
    const d = new Date(task.deadline);
    input.value = dateStr(d) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  input.placeholder = "设置截止";
  chip.replaceWith(input);
  input.focus();
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    if (commit && input.value) {
      task.deadline = new Date(input.value).toISOString();
      save();
      renderToday();
      toast("截止时间已更新");
      return;
    }
    renderToday();
  };
  input.addEventListener("change", () => finish(true));
  input.addEventListener("blur", () => finish(false));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    if (e.key === "Escape") { e.stopPropagation(); input.blur(); finish(false); }
  });
}

/* 兼容旧引用 */
function openDeadlineEditor(chip, task) {
  return openChipEditor(chip, task);
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
    tags: [], note: "", order: order
  };
  day.tasks.push(task);
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
}

function cycleStatus(id) {
  const task = findTask(id);
  if (!task || task.status === "done") return;
  task.status = task.status === "in_progress" ? "pending" : "in_progress";
  save();
  renderToday();
}

function removeTask(id) {
  const day = state.days[cursorDate];
  if (!day) return;
  day.tasks = day.tasks.filter((t) => t.id !== id);
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
  const day = state.days[cursorDate];
  return day ? day.tasks.find((t) => t.id === id) : null;
}

function renderCheckin() {
  const day = ensureDay(cursorDate);
  const btn = $("#checkin-btn");
  if (day.checkIn && day.checkIn.checked) {
    btn.textContent = "已打卡 " + fmtClock(day.checkIn.checkedAt);
    btn.classList.add("checked");
  } else {
    btn.textContent = "打卡";
    btn.classList.remove("checked");
  }
}

function doCheckin() {
  const day = ensureDay(cursorDate);
  if (day.checkIn && day.checkIn.checked) {
    toast("今天已经打过卡了");
    return;
  }
  day.checkIn = { checked: true, checkedAt: new Date().toISOString() };
  save();
  renderCheckin();
  const btn = $("#checkin-btn");
  btn.classList.remove("stamped");
  void btn.offsetWidth;
  btn.classList.add("stamped");
  toast("已打卡，今天有迹可循");
}

/* ============ 月度汇总 ============ */
let monthCursor = (function () {
  const d = new Date();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1);
})();

function monthDays(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function monthTasks(ym) {
  const out = [];
  Object.keys(state.days).forEach((d) => {
    if (!d.startsWith(ym)) return;
    const tasks = state.days[d].tasks || [];
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
    const tasks = monthTasks(ym);
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
      const arr = day ? day.tasks || [] : [];
      const dd = arr.filter((t) => t.status === "done").length;
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "hm-cell lv-" + heatLevel(arr.length ? Math.round((dd / arr.length) * 100) : 0);
      cell.textContent = d;
      cell.title = key + " · " + dd + "/" + arr.length + " 完成";
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
  if (count) count.textContent = "12 个月";
}

function buildMonthlyMD(ym) {
  const [y, m] = ym.split("-").map(Number);
  const tasks = monthTasks(ym);
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  const doing = tasks.filter((t) => t.status === "in_progress").length;
  const pending = tasks.filter((t) => t.status === "pending").length;
  const overdue = tasks.filter((t) => isOverdue(t)).length;
  let checkinDays = 0;
  Object.keys(state.days).forEach((d) => {
    if (d.startsWith(ym) && state.days[d].checkIn && state.days[d].checkIn.checked) checkinDays++;
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
  lines.push("| 已完成 | " + done + " / " + total + " |");
  lines.push("| 完成率 | " + rate + "% |");
  lines.push("| 进行中 | " + doing + " |");
  lines.push("| 未完成 | " + pending + " |");
  lines.push("| 打卡天数 | " + checkinDays + " 天 |");
  lines.push("| 逾期任务 | " + overdue + " |");
  lines.push("");
  lines.push("## 按日明细");
  lines.push("");
  const dayCount = monthDays(ym);
  for (let d = 1; d <= dayCount; d++) {
    const key = ym + "-" + pad(d);
    const day = state.days[key];
    if (!day || !day.tasks || !day.tasks.length) continue;
    const dd = new Date(y, m - 1, d);
    lines.push("### " + key + " 周" + "日一二三四五六"[dd.getDay()]);
    day.tasks.slice().sort((a, b) => a.order - b.order).forEach((t) => {
      const mark = t.status === "done" ? "✓" : t.status === "in_progress" ? "●" : "◌";
      const parts = [];
      if (t.deadline) parts.push("截止 " + fmtClock(t.deadline));
      if (t.tags && t.tags.length) parts.push("#" + t.tags.join(" #"));
      if (t.note) parts.push(t.note);
      lines.push("- " + mark + " " + t.text + (parts.length ? "（" + parts.join("｜") + "）" : ""));
    });
    lines.push("");
  }
  const followup = tasks.filter((t) => isOverdue(t) || t.status === "pending");
  if (followup.length) {
    lines.push("## 需跟进清单");
    lines.push("");
    followup.forEach((t) => {
      const span = isOverdue(t) ? " · 逾期 " + overdueHours(t) + " 小时" : "";
      lines.push("- " + t.text + "（" + t.date + "）" + span);
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
  const tasks = monthTasks(ym);
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  const doing = tasks.filter((t) => t.status === "in_progress").length;
  const pending = tasks.filter((t) => t.status === "pending").length;
  const overdue = tasks.filter((t) => isOverdue(t)).length;
  let checkinDays = 0;
  Object.keys(state.days).forEach((d) => {
    if (d.startsWith(ym) && state.days[d].checkIn && state.days[d].checkIn.checked) checkinDays++;
  });
  const rate = total ? Math.round((done / total) * 100) : 0;

  $("#month-input").value = ym;
  const wrap = $("#monthly-metrics");
  wrap.textContent = "";
  [
    { num: total, label: "任务总数" },
    { num: done + " / " + total, label: "已完成" },
    { num: rate + "%", label: "完成率" },
    { num: doing, label: "进行中" },
    { num: pending, label: "未完成" },
    { num: checkinDays + " 天", label: "打卡天数" },
    { num: overdue, label: "逾期任务" }
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
    if (!day || !day.tasks || !day.tasks.length) continue;
    dayCountWithTasks++;
    const dd = new Date(y, m - 1, d);
    const head = document.createElement("h4");
    head.className = "month-day-title";
    head.textContent = key + " 周" + "日一二三四五六"[dd.getDay()];
    const ul = document.createElement("ul");
    ul.className = "month-day-list";
    day.tasks.slice().sort((a, b) => a.order - b.order).forEach((t) => {
      const li = document.createElement("li");
      li.className = "status-" + t.status;
      const mark = t.status === "done" ? "✓" : t.status === "in_progress" ? "●" : "◌";
      const parts = [];
      if (t.deadline) parts.push("截止 " + fmtClock(t.deadline));
      if (t.tags && t.tags.length) parts.push("#" + t.tags.join(" #"));
      if (t.note) parts.push(t.note);
      li.textContent = mark + " " + t.text + (parts.length ? "（" + parts.join("｜") + "）" : "");
      ul.appendChild(li);
    });
    daysBox.append(head, ul);
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
    li.textContent = mark + " " + t.text + "（" + t.date + "）" + span;
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
    const items = day.tasks.slice().sort((a, b) => a.order - b.order).map((t) => {
      const mark = t.status === "done" ? "&#10003;" : t.status === "in_progress" ? "&#9679;" : "&#9675;";
      const parts = [];
      if (t.deadline) parts.push("截止 " + fmtClock(t.deadline));
      if (t.tags && t.tags.length) parts.push("#" + t.tags.join(" #"));
      if (t.note) parts.push(escHtml(t.note));
      return "<li>" + mark + " " + escHtml(t.text) + (parts.length ? "（" + parts.join("｜") + "）" : "") + "</li>";
    }).join("");
    daysHtml += "<h3>" + key + " 周" + "日一二三四五六"[dd.getDay()] + "</h3><ul>" + items + "</ul>";
  }
  return "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>" + y + " 年 " + m + " 月工作汇总 · 留痕</title><style>"
    + "body{font-family:'PingFang SC','Microsoft YaHei UI',system-ui,sans-serif;color:#23262b;max-width:720px;margin:24px auto;padding:0 16px;line-height:1.7}"
    + "h1{font-size:22px}h2{font-size:17px;border-bottom:1px solid #e5e1d7;padding-bottom:4px}h3{font-size:14px;margin:16px 0 6px}ul{margin:4px 0 12px;padding-left:22px}li{margin:2px 0;font-size:13px}"
    + "table{border-collapse:collapse;font-size:13px}td,th{border:1px solid #d4cfc2;padding:5px 12px}@media print{body{margin:12mm auto}}"
    + "</style></head><body>"
    + "<h1>" + y + " 年 " + m + " 月工作汇总 · 留痕</h1>"
    + "<table><tr><th>任务总数</th><th>已完成</th><th>完成率</th><th>打卡天数</th></tr>"
    + "<tr><td>" + total + "</td><td>" + done + " / " + total + "</td><td>" + rate + "%</td><td>" + checkinDays + " 天</td></tr></table>"
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
  save();
  $("#import-modal").classList.add("hidden");
  renderRoute();
  toast(mode === "replace" ? "已替换全部数据" : "已合并导入");
}

/* ============ 设置 ============ */
function renderSettings() {
  $("#theme-select").value = state.settings.style || "paper";
  $("#threshold-input").value = state.settings.gradientThresholdMin;
  $("#reminder-toggle").checked = !!state.settings.backupReminderEnabled;
}

function clearDemo() {
  const keep = state.settings;
  state = emptyState();
  state.settings = keep;
  save();
  renderRoute();
  toast("演示数据已清空");
}

function restoreDemo() {
  state = demoState();
  save();
  renderRoute();
  toast("演示数据已恢复");
}

/* ============ 事件绑定 ============ */
function bind() {
  window.addEventListener("hashchange", renderRoute);

  $("#theme-toggle").addEventListener("click", () => {
    const cur = state.settings.style || "paper";
    const next = cur === "paper" ? "dark" : "paper";
    state.settings.style = next;
    applyTheme(next);
    save();
  });

  $("#add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    addTask();
  });

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
  $("#clear-demo-btn").addEventListener("click", clearDemo);
  $("#restore-demo-btn").addEventListener("click", restoreDemo);
}

/* ============ 启动 ============ */
(async function boot() {
  await load();
  if (state) {
    applyTheme(state.settings.style || "paper");
    bind();
    renderRoute();
  } else {
    /* 数据损坏时仅绑定恢复向导，等用户选择后再进入主流程 */
    applyTheme("paper");
    bind();
  }
})();
