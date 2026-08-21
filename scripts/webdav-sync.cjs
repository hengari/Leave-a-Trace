"use strict";

/* ============================================================
 * 留痕 · WebDAV 云端同步模块（坚果云等）
 * 依赖：node:https / node:url（零外部依赖，Node >= 22）
 * 同步模型：云端文件 trace-state.json ⇄ 本地 SQLite 状态
 *   - 启动/变更/定时 触发：拉取 → 合并(按任务id/更新时间) → 推回
 *   - 合并取并集：删除操作不跨端传播（防误删覆盖）
 * ============================================================ */

const httpsMod = require("node:https");
const httpMod = require("node:http");
const { URL } = require("node:url");

/* ---------- 基础 WebDAV 请求（Basic 认证） ---------- */
function request(method, url, { auth, body, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      method,
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers: {},
      timeout
    };
    if (auth) options.headers.Authorization = "Basic " + Buffer.from(auth).toString("base64");
    if (body != null) {
      options.headers["Content-Type"] = "application/json; charset=utf-8";
      options.headers["Content-Length"] = Buffer.byteLength(body);
    }
    const lib = u.protocol === "http:" ? httpMod : httpsMod;
    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on("timeout", () => { req.destroy(new Error("WebDAV 请求超时")); });
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}

/* ---------- 文件存在性（PROPFIND 或 GET） ---------- */
async function remoteExists(url, auth) {
  try {
    const r = await request("GET", url, { auth });
    return r.status === 200;
  } catch {
    return false;
  }
}

async function remoteGet(url, auth) {
  const r = await request("GET", url, { auth });
  if (r.status === 404) return null;
  if (r.status !== 200) throw new Error("云端读取失败 HTTP " + r.status);
  try {
    return JSON.parse(r.body.toString("utf8"));
  } catch {
    throw new Error("云端文件不是有效 JSON");
  }
}

async function remotePut(url, auth, data) {
  const r = await request("PUT", url, { auth, body: JSON.stringify(data) });
  if (r.status < 200 || r.status >= 300) {
    throw new Error("云端写入失败 HTTP " + r.status + "（请确认应用密码与目录权限）");
  }
}

/* ---------- 状态合并（取并集，任务级按更新时间取新） ---------- */
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

function mergeSyncState(local, remote) {
  if (!local) return remote;
  if (!remote) return local;
  const days = {};
  const dates = new Set([...Object.keys(local.days || {}), ...Object.keys(remote.days || {})]);
  for (const date of dates) {
    const l = (local.days && local.days[date]) || null;
    const r = (remote.days && remote.days[date]) || null;
    if (!r) { days[date] = l; continue; }
    if (!l) { days[date] = r; continue; }
    const tasks = {};
    for (const t of (l.tasks || [])) if (t && t.id) tasks[t.id] = t;
    for (const t of (r.tasks || [])) if (t && t.id) tasks[t.id] = mergeTask(tasks[t.id], t);
    // 确定性排序（order → createdAt → id），保证两端合并结果一致、不产生抖动推送
    const taskList = Object.values(tasks).sort((a, b) => {
      const ao = Number(a.order ?? 9999) - Number(b.order ?? 9999);
      if (ao !== 0) return ao;
      const ac = (a.createdAt || "").localeCompare(b.createdAt || "");
      if (ac !== 0) return ac;
      return (a.id || "").localeCompare(b.id || "");
    });
    const checkIn = (r.checkIn && l.checkIn)
      ? (later(r.checkIn.checkedAt, l.checkIn.checkedAt) === r.checkIn.checkedAt ? r.checkIn : l.checkIn)
      : (r.checkIn || l.checkIn || null);
    days[date] = { ...r, ...l, tasks: taskList, checkIn };
  }
  const files = {};
  for (const f of (local.files || [])) if (f && f.id) files[f.id] = f;
  for (const f of (remote.files || [])) if (f && f.id) files[f.id] = f;
  const reports = {};
  for (const r of (local.monthlyReports || [])) if (r && (r.id || r.month)) reports[r.id || r.month] = r;
  for (const r of (remote.monthlyReports || [])) if (r && (r.id || r.month)) reports[r.id || r.month] = r;
  // 墓碑合并：按 id 取 deletedAt 较新者，并应用到 days（删除跨端传播）
  const deleted = {};
  for (const [id, t] of Object.entries(local.deletedTasks || {})) deleted[id] = t;
  for (const [id, t] of Object.entries(remote.deletedTasks || {})) {
    if (!deleted[id] || (t.deletedAt || "") > (deleted[id].deletedAt || "")) deleted[id] = t;
  }
  for (const day of Object.values(days)) {
    day.tasks = (day.tasks || []).filter((task) => !deleted[task.id]);
  }
  const localMeta = local.meta || {};
  const remoteMeta = remote.meta || {};
  const settings = (localMeta.updatedAt || "") >= (remoteMeta.updatedAt || "") ? local.settings : remote.settings;
  // 记账：按 id 取并集
  const finance = {};
  for (const f of ((local.finance && local.finance.items) || [])) if (f && f.id) finance[f.id] = f;
  for (const f of ((remote.finance && remote.finance.items) || [])) if (f && f.id) finance[f.id] = f;
  let count = 0;
  for (const day of Object.values(days)) count += (day.tasks || []).length;
  return {
    meta: {
      version: 1,
      createdAt: localMeta.createdAt || remoteMeta.createdAt || new Date().toISOString(),
      updatedAt: (localMeta.updatedAt || "") >= (remoteMeta.updatedAt || "") ? localMeta.updatedAt : remoteMeta.updatedAt,
      recordCount: count,
      nextBackupHintAt: localMeta.nextBackupHintAt ?? remoteMeta.nextBackupHintAt ?? 20
    },
    days,
    files: Object.values(files),
    monthlyReports: Object.values(reports),
    deletedTasks: deleted,
    finance: { items: Object.values(finance).sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || "")) },
    settings
  };
}

/* ---------- 一次完整同步：拉取 → 合并 → 推回 ---------- */
async function syncOnce(config, { getState, putState, log = () => {} } = {}) {
  const { url, username, password } = config;
  if (!url || !username || !password) {
    log("[sync] 配置不完整，跳过同步");
    return { ok: false, reason: "config-incomplete" };
  }
  const auth = username + ":" + password;
  const local = getState();
  const remote = await remoteGet(url, auth);
  if (remote === null) {
    // 云端还没有文件：直接推本地（首次同步）
    if (local) {
      await remotePut(url, auth, local);
      log("[sync] 首次同步：已上传本地状态");
    }
    return { ok: true, first: true };
  }
  const merged = mergeSyncState(local, remote);
  // 只比较实质内容（days/files/monthlyReports/settings），忽略 meta.updatedAt 时间戳抖动
  const subst = (s) => JSON.stringify({ days: s.days || {}, files: s.files || [], monthlyReports: s.monthlyReports || [], settings: s.settings || {} });
  const changed = subst(merged) !== subst(local) || subst(merged) !== subst(remote);
  if (changed) {
    putState(merged);
    await remotePut(url, auth, merged);
    log("[sync] 已合并并同步（本地+云端并集）");
  } else {
    log("[sync] 两端一致，无需同步");
  }
  return { ok: true, changed };
}

module.exports = { syncOnce, mergeSyncState, remoteExists, remoteGet, remotePut };
