/**
 * Second Brain — coque desktop (Electron).
 *
 * - L'interface (build Vite de native/, dossier renderer/) est servie par le
 *   protocole interne app://local/ (repli sur index.html : routes profondes).
 * - /media/… (images des notes) est relayé vers le serveur et mis en cache
 *   sur le disque : les images restent visibles hors ligne.
 * - /api/v1/documents/<id>/download et /api/v1/projects/<id>/export sont relayés avec le jeton Bearer.
 * - Les requêtes de l'application vers le serveur passent par ce processus
 *   (IPC « sb:fetch » / « sb:upload ») : pas de CORS, pas d'en-tête Origin.
 *   Seule l'origine de la session est joignable (plus POST /auth/login vers le
 *   serveur annoncé par « sb:setServer ») ; le jeton Bearer est ajouté ici.
 * - Développement : SB_DEV_URL=http://localhost:5173 charge le serveur Vite.
 *
 * - Mises à jour (updater.cjs) : vérification au démarrage, toutes les
 *   heures et au retour sur la fenêtre (10 min min.) (« sb:update-available »), installation à la demande de l'interface.
 *
 * Les données (IndexedDB) vivent dans le profil applicatif (userData).
 */
const { app, BrowserWindow, Menu, ipcMain, net, protocol, safeStorage, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { createUpdater } = require("./updater.cjs");

const RENDERER = path.join(__dirname, "renderer");
const DEV_URL = process.env.SB_DEV_URL || "";
const SMOKE = process.argv.includes("--smoke-test");
// Les tests utilisent un profil jetable : jamais celui de l'utilisateur.
if (SMOKE) app.setPath("userData", path.join(require("node:os").tmpdir(), `secondbrain-smoke-${process.pid}`));

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

// --- Session (serveur + jeton) : transmise par l'interface, conservée sur le disque ---------
// Le jeton est chiffré par le trousseau du système (safeStorage : DPAPI sous
// Windows, Keychain sous macOS) quand il est disponible ; sinon en clair (0600).
let session = { serverUrl: "", token: null };
/** Serveur visé par une connexion en cours (sb:setServer) : seul POST /api/v1/auth/login y est permis. */
let pendingServer = "";
const sessionFile = () => path.join(app.getPath("userData"), "session.json");
const canEncrypt = () => {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
};
function loadSession() {
  try {
    const raw = JSON.parse(fs.readFileSync(sessionFile(), "utf8"));
    let token = typeof raw.token === "string" ? raw.token : null;
    if (typeof raw.tokenEnc === "string") {
      try {
        token = safeStorage.decryptString(Buffer.from(raw.tokenEnc, "base64"));
      } catch {
        token = null;
      }
    }
    session = { serverUrl: originOf(raw.serverUrl) ? String(raw.serverUrl).replace(/\/+$/, "") : "", token };
  } catch {
    session = { serverUrl: "", token: null };
  }
}
function saveSession(s) {
  session = s ? { serverUrl: String(s.serverUrl || "").replace(/\/+$/, ""), token: s.token || null } : { serverUrl: session.serverUrl, token: null };
  if (!originOf(session.serverUrl)) session = { serverUrl: "", token: null };
  const stored = { serverUrl: session.serverUrl };
  if (session.token && canEncrypt()) stored.tokenEnc = safeStorage.encryptString(session.token).toString("base64");
  else stored.token = session.token;
  try {
    fs.writeFileSync(sessionFile(), JSON.stringify(stored), { mode: 0o600 });
  } catch {
    /* ignoré */
  }
}

/** Origine http(s) d'une URL, ou "" si invalide. */
function originOf(u) {
  try {
    const url = new URL(String(u));
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);
/** En-têtes que l'interface peut transmettre ; l'authentification est ajoutée ici, jamais par l'appelant. */
const ALLOWED_HEADERS = new Set(["content-type", "accept", "accept-language", "x-sync-protocol"]);

/**
 * Contrôle d'une requête de l'interface vers le serveur : uniquement l'origine
 * de la session, ou, pendant une connexion, POST /api/v1/auth/login sur le
 * serveur visé (sb:setServer). Renvoie l'URL, la méthode et les en-têtes.
 */
function checkedRequest(req, { upload = false } = {}) {
  const method = upload ? "POST" : String(req.method || "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw new Error("Méthode non autorisée");
  let url;
  try {
    url = new URL(String(req.url));
  } catch {
    throw new Error("URL invalide");
  }
  const origin = originOf(url.href);
  if (!origin) throw new Error("URL invalide");
  const sessionOrigin = originOf(session.serverUrl);
  const isLogin = !upload && method === "POST" && url.pathname === "/api/v1/auth/login";
  // Avant connexion : options publiques (lien « Mot de passe oublié », inscriptions ouvertes).
  const isOptions = !upload && method === "GET" && url.pathname === "/api/v1/auth/options";
  const allowed = (sessionOrigin && origin === sessionOrigin) || ((isLogin || isOptions) && pendingServer && origin === pendingServer);
  if (!allowed) throw new Error("Serveur non autorisé");
  const headers = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (ALLOWED_HEADERS.has(k.toLowerCase()) && typeof v === "string") headers[k] = v;
  }
  if (session.token && origin === sessionOrigin && !isLogin) headers.Authorization = `Bearer ${session.token}`;
  return { url: url.href, method, headers };
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

const DOCUMENT_DOWNLOAD = /^\/api\/v1\/documents\/[A-Za-z0-9_-]+\/download$/;
/** Exports Excel et PowerPoint d'un projet (fichiers binaires authentifiés). */
const PROJECT_EXPORT = /^\/api\/v1\/projects\/[A-Za-z0-9_-]+\/export(-pptx)?$/;

/** Message affiché par l'interface (toast) : erreurs de téléchargement. */
function notifyRenderer(message) {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) win.webContents.send("sb:notice", String(message));
}

async function proxyAuthenticated(pathname, search) {
  if (!session.serverUrl || !session.token) return new Response("Connexion requise", { status: 401 });
  try {
    const r = await net.fetch(session.serverUrl + pathname + search, { headers: { Authorization: `Bearer ${session.token}` } });
    if (r.ok) return r;
    // Échec : pas de navigation vers une page d'erreur (la fenêtre quitterait l'application).
    notifyRenderer(r.status === 404 ? "Fichier introuvable." : r.status === 401 ? "Session expirée : reconnectez-vous." : `Téléchargement impossible (${r.status}).`);
    return new Response(null, { status: 204 });
  } catch {
    notifyRenderer("Ce fichier nécessite une connexion au serveur.");
    return new Response(null, { status: 204 });
  }
}

function registerAppProtocol() {
  protocol.handle("app", async (request) => {
    const url = new URL(request.url);
    // Chemin brut (non décodé) pour le routage : pas de « %2e%2e » ni de « %2f » qui contourneraient les contrôles.
    const raw = url.pathname;
    if (raw.startsWith("/media/")) return serveMedia(raw);
    if (raw.startsWith("/api/")) {
      if (DOCUMENT_DOWNLOAD.test(raw) || PROJECT_EXPORT.test(raw)) return proxyAuthenticated(raw, url.search);
      return new Response("Introuvable", { status: 404 });
    }
    let decoded;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = "/";
    }
    const file = path.join(RENDERER, decoded);
    if (file.startsWith(RENDERER + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return net.fetch(pathToFileURL(file).toString());
    // Route de l'application (/projects/…, /tasks/…) : l'interface gère elle-même la navigation.
    return net.fetch(pathToFileURL(path.join(RENDERER, "index.html")).toString());
  });
}

// --- Mises à jour -----------------------------------------------------------------------------
let mainWindow = null;
const updater = createUpdater({ getServerUrl: () => session.serverUrl, getWindow: () => mainWindow });

// --- IPC : requêtes serveur pour l'interface -------------------------------------------------
function registerIpc() {
  // Aucun paramètre accepté : serveur et fichier sont déterminés ici (session, latest.json contrôlé).
  ipcMain.handle("sb:checkUpdate", () => updater.check());
  ipcMain.handle("sb:installUpdate", () => updater.install());
  ipcMain.handle("sb:fetch", async (_e, req) => {
    const { url, method, headers } = checkedRequest(req);
    const body = method === "GET" || typeof req.body !== "string" ? undefined : req.body;
    const r = await net.fetch(url, { method, headers, body });
    return { status: r.status, body: await r.text() };
  });
  ipcMain.handle("sb:upload", async (_e, req) => {
    const { url, headers } = checkedRequest(req, { upload: true });
    // Multipart : le Content-Type (avec boundary) est posé par FormData.
    for (const k of Object.keys(headers)) if (k.toLowerCase() === "content-type") delete headers[k];
    const form = new FormData();
    // Champs texte (dossier, livrable…) : 20 au plus, valeurs bornées.
    const fields = req.fields && typeof req.fields === "object" ? Object.entries(req.fields).slice(0, 20) : [];
    for (const [k, v] of fields) if (typeof v === "string" && k.length <= 64 && v.length <= 2000) form.append(k, v);
    form.append(String(req.field || "file"), new Blob([Buffer.from(req.data)], { type: String(req.type || "") }), String(req.filename || "image"));
    const r = await net.fetch(url, { method: "POST", headers, body: form });
    return { status: r.status, body: await r.text() };
  });
  ipcMain.handle("sb:setSession", (_e, s) => saveSession(s));
  // Connexion en cours vers `url` : autorise POST /api/v1/auth/login sur cette origine (et elle seule).
  ipcMain.handle("sb:setServer", (_e, url) => {
    pendingServer = originOf(url);
  });
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
  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
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
        { label: "Affichage", submenu: [{ role: "reload", label: "Recharger" }, ...(DEV_URL || !app.isPackaged ? [{ role: "toggleDevTools", label: "Outils de développement" }] : []), { type: "separator" }, { role: "resetZoom", label: "Taille réelle" }, { role: "zoomIn", label: "Zoom avant" }, { role: "zoomOut", label: "Zoom arrière" }, { type: "separator" }, { role: "togglefullscreen", label: "Plein écran" }] },
      ]),
    );
    loadSession();
    registerAppProtocol();
    registerIpc();
    createWindow();
    if (!SMOKE) updater.start();
    app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
