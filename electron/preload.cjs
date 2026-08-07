"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("traceDesktop", {
  isDesktop: true,
  getState: () => ipcRenderer.invoke("db:getState"),
  putState: (data) => ipcRenderer.invoke("db:putState", data),
  uploadFile: (payload) => ipcRenderer.invoke("file:upload", payload),
  getFileDataUrl: (id) => ipcRenderer.invoke("file:getDataUrl", id),
  deleteFile: (id) => ipcRenderer.invoke("file:delete", id),
  printPdf: (payload) => ipcRenderer.invoke("print:pdf", payload),
  notify: (payload) => ipcRenderer.invoke("notify", payload)
});
