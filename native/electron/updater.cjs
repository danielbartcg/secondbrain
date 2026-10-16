/**
 * Mise à jour de l'application desktop (Windows), sans dépendance npm.
 *
 * - check() : lit `<serveur>/downloads/latest.json` (publié par
 *   `npm run desktop:publish`) et compare sa version (x.y.z) à app.getVersion().
 * - install() : télécharge l'installateur NSIS dans le dossier temporaire
 *   (progression envoyée à l'interface), vérifie son empreinte SHA-256, le
 *   lance en mode silencieux (`/S --force-run` : installation puis relance de
 *   l'application) et quitte. Les données (IndexedDB, session) vivent dans le
 *   profil userData (%APPDATA%), conservé par l'installateur.
 *
 * Le serveur est celui de la session enregistrée (sinon le serveur de
 * production par défaut) ; le nom de fichier est contrôlé par expression
 * régulière : rien ne vient de l'interface.
 */
const { app, net } = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SERVER = "https://secondbrain.danielbar-tcg.fr";
const INSTALLER_RE = /^SecondBrain-Setup-\d+\.\d+\.\d+\.exe$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** Retour sur la fenêtre : nouvelle vérification, au plus toutes les 10 min. */
const FOCUS_MIN_GAP_MS = 10 * 60 * 1000;

/** Compare deux versions numériques x.y.z : <0, 0 ou >0. */
function compareVersions(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * @param {{ getServerUrl: () => string, getWindow: () => (import("electron").BrowserWindow | null) }} opts
 */
function createUpdater({ getServerUrl, getWindow }) {
  /** Dernière publication lue (pour install()). */
  let latest = null;
  let installing = false;
  let timer = null;
  let lastCheck = 0;

  const server = () => {
    const s = getServerUrl();
    try {
      const u = new URL(s);
      if (u.protocol === "https:" || u.protocol === "http:") return u.origin;
    } catch {
      /* repli */
    }
    return DEFAULT_SERVER;
  };

  const send = (channel, payload) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  async function fetchLatest() {
    const r = await net.fetch(`${server()}/downloads/latest.json`, { cache: "no-store" });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Serveur de mise à jour indisponible (${r.status}).`);
    const meta = await r.json();
    if (!meta || meta.platform !== "windows" || !VERSION_RE.test(String(meta.version)) || !INSTALLER_RE.test(String(meta.file)) || !/^[a-f0-9]{64}$/i.test(String(meta.sha256))) {
      throw new Error("Description de mise à jour invalide.");
    }
    if (meta.file !== `SecondBrain-Setup-${meta.version}.exe`) throw new Error("Description de mise à jour invalide.");
    return meta;
  }

  async function check() {
    const current = app.getVersion();
    if (process.platform !== "win32") return { available: false, current, latest: null, publishedAt: null, size: null };
    const meta = await fetchLatest();
    if (!meta) return { available: false, current, latest: null, publishedAt: null, size: null };
    latest = meta;
    return {
      available: compareVersions(meta.version, current) > 0,
      current,
      latest: meta.version,
      publishedAt: typeof meta.publishedAt === "string" ? meta.publishedAt : null,
      size: Number(meta.size) || null,
    };
  }

  async function autoCheck() {
    lastCheck = Date.now();
    try {
      const res = await check();
      if (res.available) send("sb:update-available", res);
    } catch {
      /* hors ligne ou serveur indisponible : nouvel essai plus tard */
    }
  }

  function start() {
    if (timer || process.platform !== "win32") return;
    setTimeout(() => void autoCheck(), FIRST_CHECK_DELAY_MS);
    timer = setInterval(() => void autoCheck(), CHECK_INTERVAL_MS);
    app.on("browser-window-focus", () => {
      if (Date.now() - lastCheck > FOCUS_MIN_GAP_MS) void autoCheck();
    });
  }

  async function install() {
    if (process.platform !== "win32") throw new Error("La mise à jour automatique n'est disponible que sous Windows.");
    if (installing) throw new Error("Mise à jour déjà en cours.");
    installing = true;
    try {
      // Toujours relire la description la plus récente.
      const meta = await fetchLatest();
      if (!meta || compareVersions(meta.version, app.getVersion()) <= 0) throw new Error("Aucune mise à jour disponible.");
      latest = meta;
      const r = await net.fetch(`${server()}/downloads/${meta.file}`, { cache: "no-store" });
      if (!r.ok || !r.body) throw new Error(`Téléchargement impossible (${r.status}).`);
      const total = Number(r.headers.get("content-length")) || Number(meta.size) || 0;
      const dest = path.join(app.getPath("temp"), meta.file);
      const hash = crypto.createHash("sha256");
      const out = fs.createWriteStream(dest);
      let received = 0;
      let lastSent = 0;
      try {
        const reader = r.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          hash.update(chunk);
          received += chunk.length;
          if (!out.write(chunk)) await new Promise((res) => out.once("drain", res));
          const now = Date.now();
          if (now - lastSent > 150) {
            lastSent = now;
            send("sb:update-progress", { received, total });
          }
        }
        await new Promise((res, rej) => out.end((err) => (err ? rej(err) : res())));
      } catch (e) {
        out.destroy();
        fs.rmSync(dest, { force: true });
        throw new Error(`Téléchargement interrompu : ${e && e.message ? e.message : e}`);
      }
      send("sb:update-progress", { received, total: total || received });
      if (hash.digest("hex").toLowerCase() !== String(meta.sha256).toLowerCase()) {
        fs.rmSync(dest, { force: true });
        throw new Error("Le fichier téléchargé est corrompu (empreinte SHA-256 différente). Mise à jour annulée.");
      }
      // Installation silencieuse puis relance (--force-run) ; l'installateur attend la fermeture de l'application.
      spawn(dest, ["/S", "--force-run"], { detached: true, stdio: "ignore" }).unref();
      setTimeout(() => app.quit(), 500);
      return { ok: true };
    } catch (e) {
      installing = false;
      throw e;
    }
  }

  return { check, install, start };
}

module.exports = { createUpdater, compareVersions, INSTALLER_RE };
