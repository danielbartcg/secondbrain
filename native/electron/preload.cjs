/**
 * Pont entre l'interface et le processus principal (contexte isolé, bac à
 * sable) : seules ces fonctions sont exposées, sous `window.secondBrain`.
 */
const { contextBridge, ipcRenderer } = require("electron");

/** Abonnement à un évènement du processus principal ; renvoie la fonction de désabonnement. */
function listen(channel, cb) {
  if (typeof cb !== "function") return () => {};
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const versionArg = process.argv.find((a) => a.startsWith("--sb-version="));

contextBridge.exposeInMainWorld("secondBrain", {
  platform: "desktop",
  version: versionArg ? versionArg.slice("--sb-version=".length) : "0.0.0",
  fetch: (req) => ipcRenderer.invoke("sb:fetch", req),
  upload: (req) => ipcRenderer.invoke("sb:upload", req),
  setSession: (s) => ipcRenderer.invoke("sb:setSession", s),
  setServer: (url) => ipcRenderer.invoke("sb:setServer", url),
  openExternal: (url) => ipcRenderer.invoke("sb:openExternal", url),
  // Mises à jour (updater.cjs) : aucun paramètre transmis au processus principal.
  checkUpdate: () => ipcRenderer.invoke("sb:checkUpdate"),
  installUpdate: () => ipcRenderer.invoke("sb:installUpdate"),
  onUpdateAvailable: (cb) => listen("sb:update-available", cb),
  onUpdateProgress: (cb) => listen("sb:update-progress", cb),
  // Messages du processus principal (échec de téléchargement…).
  onNotice: (cb) => listen("sb:notice", cb),
});
