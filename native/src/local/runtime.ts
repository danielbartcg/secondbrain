import { setApiTransport } from "@/lib/client";
import { createLocalApi } from "./api";
import { LocalDb } from "./db";
import { LocalModel } from "./model";
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
  if (opts.installTransport !== false) setApiTransport(handle);
  setRemoteSession({ serverUrl: store.meta.serverUrl, token: store.meta.token });
  if (typeof window !== "undefined" && window.secondBrain && store.meta.token) await window.secondBrain.setSession({ serverUrl: store.meta.serverUrl, token: store.meta.token });

  async function signIn(serverUrl: string, email: string, password: string) {
    const url = serverUrl.trim().replace(/\/+$/, "");
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
    const me = await remote<{ profile: Profile }>("GET", "/me");
    if (me.status !== 200) throw new Error("Profil introuvable.");
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
