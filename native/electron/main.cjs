/**
 * Second Brain — coque desktop (Electron).
 *
 * - L'interface (build Vite de native/, dossier renderer/) est servie par le
 *   protocole interne app://local/ (repli sur index.html : routes profondes).
 * - /media/… (images des notes) est relayé vers le serveur et mis en cache
 *   sur le disque : les images restent visibles hors ligne.
 * - /api/v1/documents/… (téléchargements) est relayé avec le jeton Bearer.
 * - Les requêtes de l'application vers le serveur passent par ce processus
 *   (IPC « sb:fetch » / « sb:upload ») : pas de CORS, pas d'en-tête Origin.
 * - Développement : SB_DEV_URL=http://localhost:5173 charge le serveur Vite.
 *
 * Les données (IndexedDB) vivent dans le profil applicatif (userData).
 */
const { app, BrowserWindow, Menu, ipcMain, net, protocol, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

const RENDERER = path.join(__dirname, "renderer");
const DEV_URL = process.env.SB_DEV_URL || "";
const SMOKE = process.argv.includes("--smoke-test");
// Les tests utilisent un profil jetable : jamais celui de l'utilisateur.
if (SMOKE) app.setPath("userData", path.join(require("node:os").tmpdir(), `secondbrain-smoke-${process.pid}`));

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

// --- Session (serveur + jeton) : transmise par l'interface, conservée sur le disque ---------
let session = { serverUrl: "", token: null };
const sessionFile = () => path.join(app.getPath("userData"), "session.json");
function loadSession() {
  try {
    session = JSON.parse(fs.readFileSync(sessionFile(), "utf8"));
  } catch {
    session = { serverUrl: "", token: null };
  }
}
function saveSession(s) {
  session = s ? { serverUrl: String(s.serverUrl || "").replace(/\/+$/, ""), token: s.token || null } : { serverUrl: session.serverUrl, token: null };
  try {
    fs.writeFileSync(sessionFile(), JSON.stringify(session), { mode: 0o600 });
  } catch {
    /* ignoré */
  }
}

const isHttpUrl = (u) => {
  try {
    const p = new URL(u).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
};

// --- Médias : relais + cache disque ---------------------------------------------------------
const mediaCache = () => path.join(app.getPath("userData"), "media-cache");
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

async function serveMedia(pathname) {
  const rel = pathname.replace(/^\/media\//, "");
  if (!/^[A-Za-z0-9/_.-]+$/.test(rel) || rel.includes("..")) return new Response("Introuvable", { status: 404 });
  const file = path.join(mediaCache(), rel);
  const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
  if (fs.existsSync(file)) return new Response(fs.readFileSync(file), { headers: { "Content-Type": type, "Cache-Control": "max-age=31536000, immutable" } });
  if (!session.serverUrl) return new Response("Introuvable", { status: 404 });
  try {
    const r = await net.fetch(session.serverUrl + pathname);
    if (!r.ok) return new Response("Introuvable", { status: r.status });
    const buf = Buffer.from(await r.arrayBuffer());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    return new Response(buf, { headers: { "Content-Type": type } });
  } catch {
    return new Response("Hors ligne", { status: 503 });
  }
}

async function proxyAuthenticated(pathname, search) {
  if (!session.serverUrl || !session.token) return new Response("Connexion requise", { status: 401 });
  try {
    return await net.fetch(session.serverUrl + pathname + search, { headers: { Authorization: `Bearer ${session.token}` } });
  } catch {
    return new Response("Ce document nécessite une connexion au serveur.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

function registerAppProtocol() {
  protocol.handle("app", async (request) => {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith("/media/")) return serveMedia(pathname);
    if (pathname.startsWith("/api/v1/documents/")) return proxyAuthenticated(pathname, url.search);
    const file = path.normalize(path.join(RENDERER, pathname));
    if (file.startsWith(RENDERER) && fs.existsSync(file) && fs.statSync(file).isFile()) return net.fetch(pathToFileURL(file).toString());
    // Route de l'application (/projects/…, /tasks/…) : l'interface gère elle-même la navigation.
    return net.fetch(pathToFileURL(path.join(RENDERER, "index.html")).toString());
  });
}

// --- IPC : requêtes serveur pour l'interface -------------------------------------------------
function registerIpc() {
  ipcMain.handle("sb:fetch", async (_e, req) => {
    if (!isHttpUrl(req.url)) throw new Error("URL invalide");
    const r = await net.fetch(req.url, { method: req.method, headers: req.headers, body: req.body ?? undefined });
    return { status: r.status, body: await r.text() };
  });
  ipcMain.handle("sb:upload", async (_e, req) => {
    if (!isHttpUrl(req.url)) throw new Error("URL invalide");
    const form = new FormData();
    form.append(req.field, new Blob([Buffer.from(req.data)], { type: req.type }), req.filename);
    const r = await net.fetch(req.url, { method: "POST", headers: req.headers, body: form });
    return { status: r.status, body: await r.text() };
  });
  ipcMain.handle("sb:setSession", (_e, s) => saveSession(s));
  ipcMain.handle("sb:openExternal", (_e, url) => (isHttpUrl(url) ? shell.openExternal(url) : undefined));
}

// --- Fenêtre ------------------------------------------------------------------------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 360,
    minHeight: 500,
    title: "Second Brain",
    backgroundColor: "#f6f5f2",
    autoHideMenuBar: true,
    show: !SMOKE,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      additionalArguments: [`--sb-version=${app.getVersion()}`],
    },
  });

  const appOrigin = DEV_URL ? new URL(DEV_URL).origin : "app://local";
  // Liens externes : navigateur du système. Fenêtres internes (aperçu de document) : autorisées.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(appOrigin + "/api/")) return { action: "allow" };
    if (isHttpUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(appOrigin)) {
      event.preventDefault();
      if (isHttpUrl(url)) void shell.openExternal(url);
    }
  });

  if (SMOKE) {
    // Test de fumée : l'interface doit démarrer sans erreur. Avec SB_SMOKE_SERVER / SB_SMOKE_EMAIL /
    // SB_SMOKE_PASSWORD, il se connecte aussi par l'interface (pont IPC), synchronise et ouvre les projets.
    win.webContents.on("console-message", (e) => e.level === "error" && console.error("[renderer]", e.message));
    const js = (code) => win.webContents.executeJavaScript(code);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    win.webContents.once("did-finish-load", async () => {
      try {
        await wait(2000);
        const result = { version: app.getVersion(), title: await js("document.querySelector('h1')?.textContent || ''") };
        if (process.env.SB_SMOKE_SERVER) {
          await js(`(() => {
            const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
            set(document.querySelector('input[type=url]'), ${JSON.stringify(process.env.SB_SMOKE_SERVER)});
            set(document.querySelector('input[type=email]'), ${JSON.stringify(process.env.SB_SMOKE_EMAIL || "")});
            set(document.querySelector('input[type=password]'), ${JSON.stringify(process.env.SB_SMOKE_PASSWORD || "")});
            document.querySelector('form button[type=submit]').click();
          })()`);
          await wait(8000);
          result.afterLogin = await js("location.pathname + ' | ' + (document.querySelector('main h1')?.textContent || document.querySelector('form p')?.textContent || '')");
          result.sync = await js("document.querySelector('aside')?.innerText.split('\\n').slice(2, 4).join(' | ') || ''");
          await js("history.pushState(null, '', '/projects'); dispatchEvent(new PopStateEvent('popstate'));");
          await wait(1500);
          result.projects = await js("[...document.querySelectorAll('main a[href^=\"/projects/\"]')].map(a => a.textContent.trim()).slice(0, 5)");
          await js("[...document.querySelectorAll('aside label')].find(l => l.textContent.includes('Hors ligne'))?.querySelector('input')?.click()");
          await wait(500);
          result.offline = await js("document.querySelector('aside')?.innerText.split('\\n')[2] || ''");
        }
        console.log(`SMOKE_OK ${JSON.stringify(result)}`);
        app.exit(0);
      } catch (e) {
        console.error(`SMOKE_FAIL ${e && e.message}`);
        app.exit(1);
      }
    });
    win.webContents.once("did-fail-load", (_e, code, desc) => {
      console.error(`SMOKE_FAIL ${code} ${desc}`);
      app.exit(1);
    });
  }

  void win.loadURL(DEV_URL || "app://local/");
  return win;
}

if (!app.requestSingleInstanceLock() && !SMOKE) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { label: "Fichier", submenu: [{ role: "quit", label: "Quitter" }] },
        { label: "Édition", submenu: [{ role: "undo", label: "Annuler" }, { role: "redo", label: "Rétablir" }, { type: "separator" }, { role: "cut", label: "Couper" }, { role: "copy", label: "Copier" }, { role: "paste", label: "Coller" }, { role: "selectAll", label: "Tout sélectionner" }] },
        { label: "Affichage", submenu: [{ role: "reload", label: "Recharger" }, { role: "toggleDevTools", label: "Outils de développement" }, { type: "separator" }, { role: "resetZoom", label: "Taille réelle" }, { role: "zoomIn", label: "Zoom avant" }, { role: "zoomOut", label: "Zoom arrière" }, { type: "separator" }, { role: "togglefullscreen", label: "Plein écran" }] },
      ]),
    );
    loadSession();
    registerAppProtocol();
    registerIpc();
    createWindow();
    app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
