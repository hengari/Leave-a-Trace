#!/usr/bin/env node
"use strict";

/* 从 bundle 提取复刻所需的核心逻辑：初始指令全文、任务解析、报告生成、项目/任务状态机 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = process.env.TEMP || ".";
const src = readFileSync(join(tmp, "pw-site", "page.js"), "utf8");
const out = [];

/* 1) V5 初始指令全文 */
const startMark = "【V5 初始指令开始】";
const sIdx = src.indexOf(startMark);
if (sIdx !== -1) {
  const endMark = "【V5 初始指令结束】";
  const eIdx = src.indexOf(endMark);
  const end = eIdx !== -1 ? eIdx + endMark.length : sIdx + 9000;
  out.push("========== V5 初始指令（完整） ==========");
  out.push(src.slice(sIdx - 20, end));
  out.push("");
}

/* 2) 找关键函数名并输出上下文 */
const probes = [
  "generatePreview",
  "importPreviewTasks",
  "updatePreviewTask",
  "parseTask",
  "buildReport",
  "saveReport",
  "addInbox",
  "addProgress",
  "addProject",
  "copyText",
  "openAi",
  "downloadFile",
  "formatReport",
  "taskCardText",
  "dueDateFromText"
];
for (const name of probes) {
  let idx = src.indexOf(name);
  let count = 0;
  while (idx !== -1 && count < 3) {
    out.push(`\n========== [fn:${name}] @${idx} ==========`);
    out.push(src.slice(Math.max(0, idx - 300), idx + 1500));
    idx = src.indexOf(name, idx + 1);
    count++;
  }
}

/* 3) 单字母/短名核心函数与报告格式串 */
const probes2 = ["function q(", "function K(", "function el(", "function ea(", "function es(", "function eF(", "function Z(", "function G(", "function d(", "function w(", "function C(", "function S(", "function A(", "report-body", "今日完成", "今日进展", "待跟进", "未完成", "进展记录", "已完成", "复制日报"];
for (const name of probes2) {
  let idx = src.indexOf(name);
  let count = 0;
  while (idx !== -1 && count < 2) {
    out.push(`\n========== [probe:${name}] @${idx} ==========`);
    out.push(src.slice(Math.max(0, idx - 250), idx + 1800));
    idx = src.indexOf(name, idx + 1);
    count++;
  }
}

/* 4) 任务清单筛选、今日统计、任务操作 */
const probes3 = ["function C(", "function eF(", "function eU(", "function eB(", "function eH(", "近 7 天", "未分项目", "批量", "今日待办", "汇报草稿", "记事本待整理", "需关注"];
for (const name of probes3) {
  let idx = src.indexOf(name);
  let count = 0;
  while (idx !== -1 && count < 2) {
    out.push(`\n========== [probe3:${name}] @${idx} ==========`);
    out.push(src.slice(Math.max(0, idx - 300), idx + 2600));
    idx = src.indexOf(name, idx + 1);
    count++;
  }
}

writeFileSync(join(here, "site-core-extract.txt"), out.join("\n"), "utf8");
console.log("written, bytes=" + out.join("\n").length);
