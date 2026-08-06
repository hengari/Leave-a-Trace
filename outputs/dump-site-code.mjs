#!/usr/bin/env node
"use strict";

/* 读取下载的站点 bundle，按关键词打印上下文，方便全链路复刻分析 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const tmp = process.env.TEMP || ".";
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(tmp, "pw-site", "page.js"), "utf8");

/* 简易美化：仅用于人读，不做语义转换 */
let pretty = src
  .replace(/;/g, ";\n")
  .replace(/\{/g, "{\n")
  .replace(/\}/g, "\n}\n")
  .replace(/\n{2,}/g, "\n");
writeFileSync(join(here, "site-bundle-pretty.js"), pretty, "utf8");

const keywords = [
  "任务内容",
  "生成任务预览",
  "复制日报",
  "保存记录",
  "新建项目",
  "排期甘特",
  "初始指令",
  "AI助手",
  "记事本",
  "导出数据",
  "导入数据",
  "清空全部数据",
  "本地资料文件夹",
  "阶段",
  "逾期",
  "已完成",
  "待开始",
  "进度",
  "attachment",
  "localStorage"
];

for (const kw of keywords) {
  let idx = 0;
  let count = 0;
  while ((idx = src.indexOf(kw, idx)) !== -1 && count < 2) {
    const from = Math.max(0, idx - 450);
    const to = Math.min(src.length, idx + kw.length + 650);
    console.log(`\n========== [${kw}] @${idx} ==========`);
    console.log(src.slice(from, to));
    idx += kw.length;
    count++;
  }
}
