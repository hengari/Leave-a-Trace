"use strict";

document.documentElement.dataset.surface = new URLSearchParams(window.location.search).get("surface") || "transparent";

const desktop = window.traceDesktop;
const list = document.getElementById("floating-task-list");
let snapshot = { tasks: [] };
let activeFilter = "work";
let knownTaskIds = new Set();
let activeFocusSession = null;

function pad(n) { return String(n).padStart(2, "0"); }

function focusElapsedSeconds(session) {
  if (!session) return 0;
  const base = Math.max(0, Number(session.accumulatedMs) || 0);
  const live = session.paused ? 0 : Math.max(0, Date.now() - Number(session.startedAt || Date.now()));
  return Math.floor((base + live) / 1000);
}

function formatFocusTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return hours ? hours + ":" + pad(minutes) + ":" + pad(secs) : pad(minutes) + ":" + pad(secs);
}

function floatingToast(text, warn) {
  let toast = document.querySelector(".floating-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "floating-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.toggle("warn", !!warn);
  toast.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function updateFocusTicks() {
  if (!activeFocusSession) return;
  const seconds = focusElapsedSeconds(activeFocusSession);
  document.querySelectorAll(".floating-focus-time").forEach((el) => { el.textContent = formatFocusTime(seconds); });
  const circumference = 2 * Math.PI * 40;
  const progress = (seconds % (25 * 60)) / (25 * 60);
  document.querySelectorAll(".floating-focus-progress").forEach((el) => {
    el.style.strokeDasharray = String(circumference);
    el.style.strokeDashoffset = String(circumference * (1 - progress));
  });
}

setInterval(updateFocusTicks, 1000);

function pendingTasks() {
  return (snapshot.tasks || []).filter((task) => !task.completed);
}

function categoryName(category) {
  return category === "life" ? "生活事务" : "工作事务";
}

function taskTime(task) {
  if (task.deadline) {
    const value = new Date(task.deadline).getTime();
    if (Number.isFinite(value)) return value;
  }
  const match = String(task.dueText || "").match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 23), Number(match[5] || 59)).getTime();
  }
  return Number.POSITIVE_INFINITY;
}

function formatDue(task) {
  if (task.deadline) {
    const due = new Date(task.deadline);
    if (!Number.isNaN(due.getTime())) {
      const today = new Date();
      const sameDay = due.getFullYear() === today.getFullYear() && due.getMonth() === today.getMonth() && due.getDate() === today.getDate();
      const clock = String(due.getHours()).padStart(2, "0") + ":" + String(due.getMinutes()).padStart(2, "0");
      return sameDay ? "今天 " + clock : (due.getMonth() + 1) + "/" + due.getDate() + " " + clock;
    }
  }
  const text = String(task.dueText || "").trim();
  return text && text !== "未明确" ? text : "未设置截止时间";
}

function sourceName(task) {
  return task.source === "workbench" ? (task.projectName || "项目工作台") : "今日记录";
}

function appendText(parent, className, text) {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = text;
  parent.appendChild(node);
  return node;
}

function renderTask(task) {
  const row = document.createElement("article");
  row.className = "floating-task" + (knownTaskIds.has(task.source + ":" + task.id) ? "" : " new-task");

  const body = document.createElement("div");
  const title = document.createElement("h2");
  title.className = "task-title";
  title.textContent = task.title;
  title.title = task.title;
  body.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "task-meta";
  appendText(meta, "task-category " + task.category, categoryName(task.category));
  appendText(meta, "task-source", sourceName(task));
  const due = appendText(meta, "task-due", formatDue(task));
  if (taskTime(task) < Date.now()) due.classList.add("overdue");
  if (Number(task.focusSeconds) > 0) appendText(meta, "task-focus-total", "专注 " + Math.floor(Number(task.focusSeconds) / 60) + " 分");
  body.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "floating-task-actions";

  const focusKey = task.source + ":" + task.id;
  const focusing = !!(activeFocusSession && activeFocusSession.key === focusKey);
  const focusAvailable = snapshot.pomodoroEnabled !== false || focusing;
  if (focusAvailable) {
    const focus = document.createElement("button");
    focus.type = "button";
    focus.className = "floating-focus-btn" + (focusing ? " active" : "");
    focus.textContent = focusing ? "专注中" : "⏱ 专注";
    focus.disabled = !!activeFocusSession;
    focus.addEventListener("click", async () => {
      const result = await desktop.focusStart({
        source: task.source,
        taskId: task.id,
        title: task.title,
        category: task.category
      });
      if (!result || !result.ok) return floatingToast((result && result.error) || "无法开始专注", true);
      activeFocusSession = result.active;
      render();
    });
    actions.appendChild(focus);
  }

  const complete = document.createElement("button");
  complete.type = "button";
  complete.className = "complete-btn";
  complete.textContent = "完成";
  complete.setAttribute("aria-label", "完成任务：" + task.title);
  complete.addEventListener("click", async () => {
    complete.disabled = true;
    complete.textContent = "同步中";
    const result = await desktop.completeTask({ source: task.source, id: task.id });
    if (!result || !result.ok) {
      complete.disabled = false;
      complete.textContent = "重试";
    }
  });
  actions.appendChild(complete);

  row.append(body, actions);

  if (focusing) {
    const panel = document.createElement("div");
    panel.className = "floating-focus-panel";
    panel.innerHTML = '<div class="floating-ring-wrap">' +
      '<svg class="floating-ring" viewBox="0 0 96 96" aria-hidden="true">' +
      '<circle class="floating-focus-track" cx="48" cy="48" r="40"></circle>' +
      '<circle class="floating-focus-progress" cx="48" cy="48" r="40"></circle></svg>' +
      '<div class="floating-focus-time">00:00</div></div>';
    const controls = document.createElement("div");
    controls.className = "floating-focus-controls";
    const pause = document.createElement("button");
    pause.type = "button";
    pause.textContent = activeFocusSession.paused ? "继续" : "暂停";
    pause.addEventListener("click", async () => {
      const result = await desktop.focusPause({ paused: !activeFocusSession.paused });
      if (!result || !result.ok) return floatingToast((result && result.error) || "操作失败", true);
      activeFocusSession = result.active;
      render();
    });
    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "primary";
    stop.textContent = "停止并结算";
    stop.addEventListener("click", async () => {
      const result = await desktop.focusStop({ cancel: false });
      if (!result || !result.ok) return floatingToast((result && result.error) || "结算失败", true);
      activeFocusSession = null;
      floatingToast([result.message, result.milestone].filter(Boolean).join(" · "));
      render();
    });
    controls.append(pause, stop);
    panel.appendChild(controls);
    row.appendChild(panel);
    setTimeout(updateFocusTicks, 0);
  }
  return row;
}

function render() {
  document.documentElement.dataset.theme = (snapshot.style === "modern" ? "warm" : snapshot.style) || "paper";
  const pending = pendingTasks();
  const work = pending.filter((task) => task.category !== "life");
  const life = pending.filter((task) => task.category === "life");
  document.getElementById("pending-total").textContent = String(pending.length);
  document.getElementById("work-count").textContent = String(work.length);
  document.getElementById("life-count").textContent = String(life.length);
  document.getElementById("list-title").textContent = activeFilter === "all" ? "全部待办" : categoryName(activeFilter);
  document.getElementById("show-all").textContent = activeFilter === "all" ? "按分类查看" : "查看全部";

  document.querySelectorAll("[data-filter]").forEach((button) => {
    const active = button.dataset.filter === activeFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });

  const visible = (activeFilter === "all" ? pending : pending.filter((task) => task.category === activeFilter))
    .sort((a, b) => {
      const priority = { "高": 0, "中": 1, "低": 2 };
      const pa = priority[a.priority] == null ? 1 : priority[a.priority];
      const pb = priority[b.priority] == null ? 1 : priority[b.priority];
      return taskTime(a) - taskTime(b) || pa - pb || String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt));
    });

  list.textContent = "";
  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const strong = document.createElement("strong");
    strong.textContent = activeFilter === "all" ? "待办已经清空" : categoryName(activeFilter) + "已完成";
    const hint = document.createElement("span");
    hint.textContent = "新任务添加后会自动出现在这里";
    empty.append(strong, hint);
    list.appendChild(empty);
  } else {
    visible.slice(0, 12).forEach((task) => list.appendChild(renderTask(task)));
  }
  knownTaskIds = new Set(pending.map((task) => task.source + ":" + task.id));
}

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    render();
  });
});

document.getElementById("show-all").addEventListener("click", () => {
  activeFilter = activeFilter === "all" ? "work" : "all";
  render();
});

document.getElementById("hide-window").addEventListener("click", () => desktop.hideFloating());
document.getElementById("open-main").addEventListener("click", () => desktop.openMainWindow());

const resizeHandle = document.getElementById("resize-handle");
resizeHandle.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const startX = event.screenX;
  const startY = event.screenY;
  const startWidth = window.outerWidth;
  const startHeight = window.outerHeight;
  resizeHandle.setPointerCapture(event.pointerId);

  const resize = (moveEvent) => {
    const width = Math.max(340, Math.min(440, startWidth + moveEvent.screenX - startX));
    const height = Math.max(420, startHeight + moveEvent.screenY - startY);
    window.resizeTo(Math.round(width), Math.round(height));
  };
  const stop = () => {
    resizeHandle.removeEventListener("pointermove", resize);
    resizeHandle.removeEventListener("pointerup", stop);
    resizeHandle.removeEventListener("pointercancel", stop);
  };

  resizeHandle.addEventListener("pointermove", resize);
  resizeHandle.addEventListener("pointerup", stop);
  resizeHandle.addEventListener("pointercancel", stop);
});

desktop.onTaskStateChanged((next) => {
  snapshot = next || { tasks: [] };
  render();
});

desktop.onFocusStateChanged((next) => {
  activeFocusSession = next && next.active || null;
  render();
});

desktop.getTaskSnapshot().then((next) => {
  snapshot = next || { tasks: [] };
  knownTaskIds = new Set(pendingTasks().map((task) => task.source + ":" + task.id));
  render();
});

desktop.focusGetState().then((next) => {
  activeFocusSession = next && next.active || null;
  render();
});
