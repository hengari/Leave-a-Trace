#!/usr/bin/env node
"use strict";

/* ============ 零依赖静态文件服务器（仅限本地运行“留痕”原型） ============ */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const webRoot = resolve(projectRoot, "src", "web");
const defaultPort = 8787;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

const port = Number(process.argv[process.argv.indexOf("--port") + 1] || process.env.PORT || defaultPort);

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let filePath = resolve(webRoot, "." + (urlPath === "/" ? "/index.html" : urlPath));

    /* 防目录穿越：解析后的路径必须仍在 webRoot 内 */
    if (filePath !== webRoot && !filePath.startsWith(webRoot + sep)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("403 Forbidden");
      return;
    }

    let info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = resolve(filePath, "index.html");
      info = await stat(filePath);
    }

    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 Not Found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`留痕原型已启动：http://127.0.0.1:${port}/`);
  console.log(`静态目录：${webRoot}`);
});
