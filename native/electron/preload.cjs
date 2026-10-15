/**
 * Pont entre l'interface et le processus principal (contexte isolé, bac à
 * sable) : seules ces fonctions sont exposées, sous `window.secondBrain`.
 */
const { contextBridge, ipcRenderer } = require("electron");

const versionArg = process.argv.find((a) => a.startsWith("--sb-version="));

contextBridge.exposeInMainWorld("secondBrain", {
  platform: "desktop",
  version: versionArg ? versionArg.slice("--sb-version=".length) : "0.0.0",
  fetch: (req) => ipcRenderer.invoke("sb:fetch", req),
  upload: (req) => ipcRenderer.invoke("sb:upload", req),
  setSession: (s) => ipcRenderer.invoke("sb:setSession", s),
  setServer: (url) => ipcRenderer.invoke("sb:setServer", url),
  openExternal: (url) => ipcRenderer.invoke("sb:openExternal", url),
});
