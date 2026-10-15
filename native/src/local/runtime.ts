import { setApiTransport } from "@/lib/client";
import { createLocalApi } from "./api";
import { LocalDb } from "./db";
import { LocalModel } from "./model";
import { mediaRewriter, platform } from "./platform";
import { NetworkError, remote, setRemoteSession } from "./remote";
import { Store } from "./store";
import { SyncEngine } from "./sync";
import type { Profile } from "./types";

/**
 * Assemblage de la couche hors ligne : base IndexedDB, magasin, modèle de
 * lecture, moteur de synchro, API locale branchée sur `api` (client.ts).
 */
export type Runtime = {
  store: Store;
  model: LocalModel;
  sync: SyncEngine;
  handle: (method: string, path: string, body?: unknown) => Promise<unknown>;
  signIn: (serverUrl: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

export async function createRuntime(opts: { factory?: IDBFactory; dbName?: string; installTransport?: boolean } = {}): Promise<Runtime> {
  const store = new Store(new LocalDb(opts.factory ?? indexedDB, opts.dbName));
  await store.load();
  const model = new LocalModel(store);
  const sync = new SyncEngine(store);
  const handle = createLocalApi(store, sync, model);
  if (opts.installTransport !== false) {
    if (platform() === "ios") {
      // iPhone : URL de médias absolues à l'affichage, relatives à l'enregistrement.
      const media = mediaRewriter(() => store.meta.serverUrl);
      const isPlain = (b: unknown) => b !== null && typeof b === "object" && (Array.isArray(b) || Object.getPrototypeOf(b) === Object.prototype);
      setApiTransport(async (method, path, body) => media.toAbsolute(await handle(method, path, isPlain(body) ? media.toRelative(body) : body)));
    } else setApiTransport(handle);
  }
  setRemoteSession({ serverUrl: store.meta.serverUrl, token: store.meta.token });
  if (typeof window !== "undefined" && window.secondBrain && store.meta.token) await window.secondBrain.setSession({ serverUrl: store.meta.serverUrl, token: store.meta.token });

  async function signIn(serverUrl: string, email: string, password: string) {
    const url = serverUrl.trim().replace(/\/+$/, "");
    // HTTPS obligatoire (le mot de passe et le jeton transitent), sauf serveur local de développement.
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Adresse du serveur invalide.");
    }
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) {
      throw new Error("Le serveur doit être en HTTPS (https://…), sauf en local (localhost).");
    }
    if (typeof window !== "undefined" && window.secondBrain?.setServer) await window.secondBrain.setServer(url);
    setRemoteSession({ serverUrl: url, token: null });
    let r;
    try {
      r = await remote<{ token?: string; error?: { message: string } }>("POST", "/auth/login", { email, password, client: "Second Brain (application)" });
    } catch (e) {
      throw new Error(e instanceof NetworkError ? `Serveur injoignable (${url}).` : String(e));
    }
    if (r.status !== 200 || !r.data.token) throw new Error(r.data.error?.message ?? `Connexion refusée (${r.status}).`);
    const token = r.data.token;
    setRemoteSession({ serverUrl: url, token });
    // La coque Electron n'accepte que l'origine de sa session et ajoute elle-même le jeton : on la lui transmet avant /me.
    if (typeof window !== "undefined" && window.secondBrain) await window.secondBrain.setSession({ serverUrl: url, token });
    const me = await remote<{ profile: Profile }>("GET", "/me");
    if (me.status !== 200) {
      // Échec : la coque retrouve la session précédente.
      if (typeof window !== "undefined" && window.secondBrain) {
        await window.secondBrain.setSession(store.meta.token ? { serverUrl: store.meta.serverUrl, token: store.meta.token } : null);
      }
      setRemoteSession({ serverUrl: store.meta.serverUrl, token: store.meta.token });
      throw new Error("Profil introuvable.");
    }
    // Nouveau compte ou autre serveur : on repart d'une base vide.
    if (store.meta.user?.id !== me.data.profile.id || store.meta.serverUrl !== url) await store.wipe();
    store.setMeta("serverUrl", url);
    store.setMeta("token", token);
    store.setMeta("user", me.data.profile);
    store.setMeta("cursor", 0);
    await store.flush();
    if (typeof window !== "undefined" && window.secondBrain) await window.secondBrain.setSession({ serverUrl: url, token });
    sync.status = { ...sync.status, signedOut: false };
    await sync.syncNow();
  }

  async function signOut() {
    await handle("POST", "/auth/logout");
    setRemoteSession({ serverUrl: store.meta.serverUrl, token: null });
  }

  return { store, model, sync, handle, signIn, signOut };
}
