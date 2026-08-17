"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("traceDesktop", {
  isDesktop: true,
  getState: () => ipcRenderer.invoke("db:getState"),
  putState: (data) => ipcRenderer.invoke("db:putState", data),
  createBackup: () => ipcRenderer.invoke("backup:create"),
  uploadFile: (payload) => ipcRenderer.invoke("file:upload", payload),
  getFileDataUrl: (id) => ipcRenderer.invoke("file:getDataUrl", id),
  deleteFile: (id) => ipcRenderer.invoke("file:delete", id),
  printPdf: (payload) => ipcRenderer.invoke("print:pdf", payload),
  notify: (payload) => ipcRenderer.invoke("notify", payload),
  getTaskSnapshot: () => ipcRenderer.invoke("tasks:getSnapshot"),
  completeTask: (payload) => ipcRenderer.invoke("tasks:complete", payload),
  focusStart: (payload) => ipcRenderer.invoke("focus:start", payload),
  focusPause: (payload) => ipcRenderer.invoke("focus:pause", payload),
  focusStop: (payload) => ipcRenderer.invoke("focus:stop", payload),
  focusGetState: () => ipcRenderer.invoke("focus:getState"),
  syncWorkbenchTasks: (tasks) => ipcRenderer.invoke("workbench:syncTasks", tasks),
  getFloatingState: () => ipcRenderer.invoke("floating:getState"),
  toggleFloating: () => ipcRenderer.invoke("floating:toggle"),
  hideFloating: () => ipcRenderer.invoke("floating:hide"),
  openMainWindow: () => ipcRenderer.invoke("floating:openMain"),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  toggleMaximize: () => ipcRenderer.invoke("window:maximize"),
  onTaskStateChanged: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("tasks:stateChanged", listener);
    return () => ipcRenderer.removeListener("tasks:stateChanged", listener);
  },
  onFocusStateChanged: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("focus:stateChanged", listener);
    return () => ipcRenderer.removeListener("focus:stateChanged", listener);
  },
  onFloatingVisibility: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("floating:visibility", listener);
    return () => ipcRenderer.removeListener("floating:visibility", listener);
  },
  onWorkbenchComplete: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("workbench:completeTask", listener);
    return () => ipcRenderer.removeListener("workbench:completeTask", listener);
  }
});
