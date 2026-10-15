/// <reference types="vite/client" />

/** Pont exposé par la coque Electron (native/electron/preload.cjs). Absent dans le navigateur. */
interface SecondBrainBridge {
  platform: "desktop";
  version: string;
  /** Requête HTTP vers le serveur, faite par le processus principal (pas de CORS). */
  fetch(req: { url: string; method: string; headers: Record<string, string>; body?: string | null }): Promise<{ status: number; body: string }>;
  /** Téléversement multipart (image de note) vers le serveur. */
  upload(req: { url: string; headers: Record<string, string>; field: string; filename: string; type: string; data: ArrayBuffer }): Promise<{ status: number; body: string }>;
  /** Transmet le serveur et le jeton au processus principal (médias et téléchargements de documents). */
  setSession(s: { serverUrl: string; token: string } | null): Promise<void>;
  /** Annonce le serveur d'une connexion en cours (seul POST /api/v1/auth/login y est permis avant la session). Absent des anciennes coques. */
  setServer?(url: string): Promise<void>;
  openExternal(url: string): Promise<void>;
}

interface Window {
  secondBrain?: SecondBrainBridge;
}
