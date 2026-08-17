#!/usr/bin/env node
"use strict";
/* 留痕同步部署验证脚本：环境 / 配置 / 云端连通 / 本地服务 / 数据一致性 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import https from "node:https";
import http from "node:http";

const root = resolve(import.meta.dirname, "..", "..", "..", "..");
let failures = 0;
const check = (name, ok, extra) => {
  console.log((ok ? "PASS" : "FAIL") + " | " + name + (extra ? " | " + extra : ""));
  if (!ok) failures += 1;
};

/* 1. Node 版本 */
const [maj, min] = process.versions.node.split(".").map(Number);
check("Node >= 22.13", maj > 22 || (maj === 22 && min >= 13), "当前 " + process.versions.node);

/* 2. 配置文件 */
const cfgPath = join(root, "sync-config.json");
if (!existsSync(cfgPath)) {
  check("sync-config.json 存在", false, "请先复制 sync-config.example.json 并填入邮箱/应用密码");
  process.exit(1);
}
let cfg = null;
try { cfg = JSON.parse(readFileSync(cfgPath, "utf8")); } catch (e) { check("sync-config.json 可解析", false, e.message); process.exit(1); }
check("配置已填邮箱与应用密码", !!(cfg.username && cfg.password && cfg.url), cfg.url || "");

/* 3. WebDAV 连通性 */
function dav(method, path) {
  return new Promise((resolve2) => {
    const u = new URL(path);
    const req = https.request({ hostname: u.hostname, path: u.pathname, method, headers: { Authorization: "Basic " + Buffer.from(cfg.username + ":" + cfg.password).toString("base64") }, timeout: 20000 }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve2({ status: res.statusCode, body: d }));
    });
    req.on("error", () => resolve2({ status: 0 }));
    req.on("timeout", () => { req.destroy(); resolve2({ status: 0 }); });
    req.end();
  });
}
const cloud = await dav("GET", cfg.url);
check("坚果云 WebDAV 可访问", cloud.status === 200, "trace-state.json " + (cloud.status === 200 ? "存在(云端已有数据)" : "HTTP " + cloud.status + " 或网络不可达"));

/* 4. 本地服务 */
function localGet(path) {
  return new Promise((resolve2) => {
    http.get({ host: "127.0.0.1", port: 8787, path }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve2({ status: res.statusCode, body: d }));
    }).on("error", () => resolve2({ status: 0, body: "" }));
  });
}
const health = await localGet("/api/health");
check("本地服务运行中(8787)", health.status === 200, health.status === 200 ? "http://127.0.0.1:8787" : "未启动？请运行 node scripts/serve.mjs");

/* 5. 数据一致性 */
if (health.status === 200 && cloud.status === 200) {
  try {
    const local = JSON.parse((await localGet("/api/state")).body);
    const cloudState = JSON.parse(cloud.body);
    const count = (s) => { let n = 0; for (const d of Object.values(s.days || {})) n += (d.tasks || []).length; return n; };
    const lc = count(local.data), cc = count(cloudState);
    check("本地与云端任务数一致", lc === cc, "本地 " + lc + " 条 / 云端 " + cc + " 条");
  } catch (e) {
    check("数据一致性检查", false, e.message);
  }
}

console.log(failures === 0 ? "=== 全部通过，部署成功 ===" : "=== " + failures + " 项未通过，见上方 FAIL ===");
process.exit(failures === 0 ? 0 : 1);
