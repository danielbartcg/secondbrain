import { SYNC_PROTOCOL } from "./types";

/**
 * Accès au serveur depuis l'application native. Trois transports :
 *  - coque Electron : le processus principal fait la requête (pas de CORS) ;
 *  - navigateur en développement (Vite) : relais /__remote vers le serveur ;
 *  - iPhone (Capacitor) et tests Node : `fetch` sur l'URL absolue (sur iPhone,
 *    CapacitorHttp le fait passer par la pile réseau native : pas de CORS).
 * Toutes les requêtes portent le jeton Bearer et la version de protocole.
 */

export class NetworkError extends Error {
  constructor(message = "Serveur injoignable") {
    super(message);
  }
}

export type RemoteResponse<T = unknown> = { status: number; data: T };

type Session = { serverUrl: string; token: string | null };
let session: Session = { serverUrl: "", token: null };
/** Forcer le mode hors ligne (tests, et bascule manuelle). */
let forcedOffline = false;

export function setRemoteSession(s: Session) {
  session = { serverUrl: s.serverUrl.replace(/\/+$/, ""), token: s.token };
}
export function getRemoteSession(): Session {
  return session;
}
export function setForcedOffline(v: boolean) {
  forcedOffline = v;
}
export function isForcedOffline(): boolean {
  return forcedOffline;
}

/** Navigateur en développement (Vite) : relais /__remote. Positionné par native/src/main.tsx. */
const isBrowserDev = () => typeof window !== "undefined" && !window.secondBrain && (globalThis as { __SB_DEV_PROXY__?: boolean }).__SB_DEV_PROXY__ === true;

function absolute(path: string): string {
  if (isBrowserDev()) return "/__remote/api/v1" + path;
  return session.serverUrl + "/api/v1" + path;
}

export async function remote<T = unknown>(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<RemoteResponse<T>> {
  if (forcedOffline) throw new NetworkError("Mode hors ligne");
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Sync-Protocol": String(SYNC_PROTOCOL), ...extraHeaders };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  const payload = body === undefined ? null : JSON.stringify(body);
  let status: number;
  let text: string;
  try {
    if (typeof window !== "undefined" && window.secondBrain) {
      const r = await window.secondBrain.fetch({ url: absolute(path), method, headers, body: payload });
      status = r.status;
      text = r.body;
    } else {
      const r = await fetch(absolute(path), { method, headers, body: payload });
      status = r.status;
      text = await r.text();
    }
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : "Serveur injoignable");
  }
  // Un relais de développement renvoie 502/504 quand le serveur est arrêté.
  if (status === 502 || status === 503 || status === 504) throw new NetworkError(`Serveur indisponible (${status})`);
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  return { status, data: data as T };
}

/**
 * Formulaire multipart (documents de projet, fichiers de livrable) : un fichier
 * et des champs texte. Coque Electron : envoyé par le processus principal.
 */
export async function remoteForm<T = unknown>(path: string, form: FormData): Promise<RemoteResponse<T>> {
  if (forcedOffline) throw new NetworkError("Mode hors ligne");
  const headers: Record<string, string> = { "X-Sync-Protocol": String(SYNC_PROTOCOL) };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  let status: number;
  let text: string;
  try {
    if (typeof window !== "undefined" && window.secondBrain) {
      let file: { field: string; blob: File | Blob; name: string } | null = null;
      const fields: Record<string, string> = {};
      for (const [k, v] of form.entries()) {
        if (typeof v === "string") fields[k] = v;
        else if (!file) file = { field: k, blob: v, name: (v as File).name || "fichier" };
      }
      if (!file) throw new Error("Aucun fichier à envoyer.");
      const r = await window.secondBrain.upload({ url: absolute(path), headers, field: file.field, filename: file.name, type: file.blob.type, data: await file.blob.arrayBuffer(), fields });
      status = r.status;
      text = r.body;
    } else {
      const r = await fetch(absolute(path), { method: "POST", headers, body: form });
      status = r.status;
      text = await r.text();
    }
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : "Serveur injoignable");
  }
  if (status === 502 || status === 503 || status === 504) throw new NetworkError(`Serveur indisponible (${status})`);
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  return { status, data: data as T };
}

/** Téléversement d'une image de note vers le serveur ; renvoie l'URL /media/…. */
export async function remoteUpload(file: Blob, filename: string): Promise<string> {
  if (forcedOffline) throw new NetworkError("Mode hors ligne");
  const headers: Record<string, string> = session.token ? { Authorization: `Bearer ${session.token}` } : {};
  let status: number;
  let text: string;
  try {
    if (typeof window !== "undefined" && window.secondBrain) {
      const r = await window.secondBrain.upload({ url: absolute("/uploads"), headers, field: "file", filename, type: file.type, data: await file.arrayBuffer() });
      status = r.status;
      text = r.body;
    } else {
      const form = new FormData();
      form.append("file", file, filename);
      const r = await fetch(absolute("/uploads"), { method: "POST", headers, body: form });
      status = r.status;
      text = await r.text();
    }
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : "Serveur injoignable");
  }
  const data = JSON.parse(text || "{}") as { url?: string; error?: { message: string } };
  if (status !== 201 || !data.url) throw new Error(data.error?.message ?? `Téléversement refusé (${status})`);
  return data.url;
}
