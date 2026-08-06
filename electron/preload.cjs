"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("traceDesktop", {
  isDesktop: true,
  getLibraryRoot: () => ipcRenderer.invoke("library:getRoot"),
  chooseLibraryRoot: () => ipcRenderer.invoke("library:setRoot"),
  saveAttachment: (payload) => ipcRenderer.invoke("file:saveAttachment", payload),
  openPath: (p) => ipcRenderer.invoke("file:openPath", p),
  showInFolder: (p) => ipcRenderer.invoke("file:showInFolder", p),
  printPdf: (payload) => ipcRenderer.invoke("print:pdf", payload),
  notify: (payload) => ipcRenderer.invoke("notify", payload)
});
