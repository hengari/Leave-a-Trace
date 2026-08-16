// 创建 GitHub Release 并上传安装包（v1.0.13）
// token 从 git credential 获取，不落地到文件
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO = "hengari/Leave-a-Trace";
const TAG = "v1.0.13";
const EXE = path.resolve("release/留痕-1.0.13-setup.exe");

function getToken() {
  const r = spawnSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
  });
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("password=")) return line.slice("password=".length).trim();
  }
  throw new Error("no token from git credential");
}

const token = getToken();

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "release-upload",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

// 1. 创建 release（若已存在则复用）
const releaseBody = `## 留痕 v1.0.13

本次更新内容：

- 浮窗彻底解决"灰色矩形/黑底"问题：纯白实底 + 顶部高光渐变模拟玻璃质感，任何显示器/桌面环境下都是干净白色卡片
- 主窗口无边框化：自绘最小化 / 最大化 / 关闭按钮，导航固定、内容区内部滚动
- 三主题体系：暖阳（默认浅金）/ 极夜（纯黑冷绿）/ 晴空（白色浅蓝）
- 性能优化：移除大面积 backdrop-filter、动画降级为 opacity、焦点计时降频
- 字体统一雅黑、框架颜色统一、细节 UI 打磨

> 安装包为 NSIS 安装器，安装后可自由选择安装目录。`;

let release = null;
try {
  release = await api(`https://api.github.com/repos/${REPO}/releases/tags/${TAG}`);
  console.log("release exists, reuse id=" + release.id);
} catch (e) {
  release = await api(`https://api.github.com/repos/${REPO}/releases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: TAG,
      name: `留痕 ${TAG}`,
      body: releaseBody,
    }),
  });
  console.log("release created id=" + release.id);
}

// 2. 上传安装包
const size = fs.statSync(EXE).size;
console.log(`uploading ${path.basename(EXE)} (${(size / 1024 / 1024).toFixed(1)} MB)...`);
const assetName = encodeURIComponent(path.basename(EXE));
const buf = fs.readFileSync(EXE);
const asset = await api(
  `https://uploads.github.com/repos/${REPO}/releases/${release.id}/assets?name=${assetName}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "Content-Length": String(size) },
    body: buf,
  }
);
console.log("asset uploaded:", asset.name, asset.size, "bytes");
console.log("release url:", release.html_url);
