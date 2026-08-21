"use strict";

/* ============================================================
 * 留痕 · 状态合并模块（桌面端 main.cjs 与 Web 服务 serve.mjs 共用）
 * 语义：并集合并 + 墓碑（deletedTasks）删除传播
 * - 按日期/任务 id 取并集（incoming 优先）
 * - 同一任务冲突取 updatedAt 较新者
 * - 删除通过墓碑跨端传播，不会把已删任务"复活"
 * ============================================================ */

function later(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function mergeTask(a, b) {
  if (!a) return b;
  if (!b) return a;
  const at = a.updatedAt || a.createdAt || "";
  const bt = b.updatedAt || b.createdAt || "";
  return at >= bt ? a : b;
}

function mergeState(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;
  const days = {};
  const allDates = new Set([...Object.keys(existing.days || {}), ...Object.keys(incoming.days || {})]);
  for (const date of allDates) {
    const ex = (existing.days && existing.days[date]) || null;
    const inc = (incoming.days && incoming.days[date]) || null;
    if (!inc) { days[date] = ex; continue; }
    if (!ex) { days[date] = inc; continue; }
    const tasks = {};
    for (const t of (ex.tasks || [])) if (t && t.id) tasks[t.id] = t;
    for (const t of (inc.tasks || [])) if (t && t.id) tasks[t.id] = mergeTask(tasks[t.id], t);
    // 确定性排序（order → createdAt → id），保证两端合并结果一致、不产生抖动推送
    const taskList = Object.values(tasks).sort((a, b) => {
      const ao = Number(a.order ?? 9999) - Number(b.order ?? 9999);
      if (ao !== 0) return ao;
      const ac = (a.createdAt || "").localeCompare(b.createdAt || "");
      if (ac !== 0) return ac;
      return (a.id || "").localeCompare(b.id || "");
    });
    const checkIn = (inc.checkIn && ex.checkIn)
      ? (later(inc.checkIn.checkedAt, ex.checkIn.checkedAt) === inc.checkIn.checkedAt ? inc.checkIn : ex.checkIn)
      : (inc.checkIn || ex.checkIn || null);
    days[date] = { ...inc, ...ex, tasks: taskList, checkIn };
  }
  const files = {};
  for (const f of (existing.files || [])) if (f && f.id) files[f.id] = f;
  for (const f of (incoming.files || [])) if (f && f.id) files[f.id] = f;
  const reports = {};
  for (const r of (existing.monthlyReports || [])) if (r && (r.id || r.month)) reports[r.id || r.month] = r;
  for (const r of (incoming.monthlyReports || [])) if (r && (r.id || r.month)) reports[r.id || r.month] = r;
  // 墓碑合并：按 id 取 deletedAt 较新者，并应用到 days
  const deleted = {};
  for (const [id, t] of Object.entries(existing.deletedTasks || {})) deleted[id] = t;
  for (const [id, t] of Object.entries(incoming.deletedTasks || {})) {
    if (!deleted[id] || (t.deletedAt || "") > (deleted[id].deletedAt || "")) deleted[id] = t;
  }
  for (const day of Object.values(days)) {
    day.tasks = (day.tasks || []).filter((task) => !deleted[task.id]);
  }
  const exMeta = existing.meta || {};
  const inMeta = incoming.meta || {};
  // 记账：按 id 取并集（同一笔冲突保留双方，不丢账目）
  const finance = {};
  for (const f of (existing.finance && existing.finance.items || [])) if (f && f.id) finance[f.id] = f;
  for (const f of (incoming.finance && incoming.finance.items || [])) if (f && f.id) finance[f.id] = f;
  let count = 0;
  for (const day of Object.values(days)) count += (day.tasks || []).length;
  return {
    meta: {
      version: 1,
      createdAt: inMeta.createdAt || exMeta.createdAt || new Date().toISOString(),
      updatedAt: (inMeta.updatedAt || "") >= (exMeta.updatedAt || "") ? inMeta.updatedAt : exMeta.updatedAt,
      recordCount: count,
      nextBackupHintAt: inMeta.nextBackupHintAt ?? exMeta.nextBackupHintAt ?? 20
    },
    days,
    files: Object.values(files),
    monthlyReports: Object.values(reports),
    deletedTasks: deleted,
    finance: { items: Object.values(finance).sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || "")) },
    settings: incoming.settings || existing.settings || {}
  };
}

module.exports = { mergeState };
