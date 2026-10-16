import { useEffect, useSyncExternalStore } from "react";
import { AlertTriangle, Download, Loader2, X } from "lucide-react";
import type { Runtime } from "../local/runtime";

/**
 * Bandeau de mise à jour de l'application desktop (coque Electron ≥ 0.2.0).
 *
 * Le processus principal vérifie `latest.json` au démarrage, toutes les
 * heures et au retour sur la fenêtre et annonce une nouvelle version (« sb:update-available »). « Mettre à
 * jour » synchronise d'abord (les modifications restantes sont conservées
 * dans IndexedDB, profil non touché par l'installateur), puis télécharge,
 * vérifie et lance l'installateur ; l'application redémarre seule.
 *
 * La page Préférences (composant partagé avec le site) déclenche le même
 * parcours via l'évènement `INSTALL_UPDATE_EVENT` sur `window`.
 */

/** Évènement (annulable) émis par les Préférences pour lancer la mise à jour ici. */
export const INSTALL_UPDATE_EVENT = "secondbrain:install-update";

type Phase = "idle" | "syncing" | "confirm" | "downloading" | "installing" | "error";
type State = { info: SecondBrainUpdateInfo | null; dismissed: boolean; phase: Phase; pending: number; received: number; total: number; error: string | null };

let state: State = { info: null, dismissed: false, phase: "idle", pending: 0, received: 0, total: 0, error: null };
const listeners = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

// Abonnement dès le chargement du module : l'annonce peut arriver avant la connexion.
const bridge = typeof window !== "undefined" ? window.secondBrain : undefined;
bridge?.onUpdateAvailable?.((info) => {
  if (info?.available && info.latest !== state.info?.latest) set({ info, dismissed: false });
});
bridge?.onUpdateProgress?.((p) => {
  if (state.phase === "downloading") set({ received: p.received, total: p.total });
});

/** Message d'erreur sans le préfixe ajouté par Electron (« Error invoking remote method … »). */
function cleanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") || "Mise à jour impossible.";
}

async function download() {
  set({ phase: "downloading", received: 0, total: state.info?.size ?? 0, error: null });
  try {
    await bridge!.installUpdate!();
    set({ phase: "installing" });
  } catch (e) {
    set({ phase: "error", error: cleanError(e) });
  }
}

/** Synchronise, prévient s'il reste des modifications non envoyées, puis installe. */
async function startUpdate(runtime: Runtime) {
  if (!bridge?.installUpdate || state.phase === "syncing" || state.phase === "downloading" || state.phase === "installing") return;
  set({ phase: "syncing", error: null, dismissed: false });
  try {
    await runtime.sync.syncNow();
  } catch {
    /* hors ligne : on prévient ci-dessous */
  }
  try {
    await runtime.store.flush();
  } catch {
    /* déjà persisté au fil de l'eau */
  }
  const pending = runtime.store.outbox.length;
  if (pending > 0) set({ phase: "confirm", pending });
  else await download();
}

function useUpdateState(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

export function UpdateBanner({ runtime }: { runtime: Runtime }) {
  const st = useUpdateState();

  // Demande venant des Préférences : on prend la main (preventDefault) et on lance le parcours.
  useEffect(() => {
    const onRequest = (e: Event) => {
      e.preventDefault();
      const info = (e as CustomEvent<SecondBrainUpdateInfo | undefined>).detail;
      if (info?.available) set({ info });
      void startUpdate(runtime);
    };
    window.addEventListener(INSTALL_UPDATE_EVENT, onRequest);
    return () => window.removeEventListener(INSTALL_UPDATE_EVENT, onRequest);
  }, [runtime]);

  if (!bridge?.installUpdate) return null;
  const busy = st.phase !== "idle" && st.phase !== "error";
  if (!st.info?.available && !busy && st.phase !== "error") return null;
  if (st.dismissed && !busy) return null;

  const version = st.info?.latest ?? "";
  const pct = st.total > 0 ? Math.min(100, Math.round((st.received / st.total) * 100)) : null;
  const btn = "rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-on-brand hover:bg-brand-700 disabled:opacity-50";
  const ghost = "rounded-lg px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-brand-100 bg-brand-50 px-4 py-2 text-sm text-brand-700" role="status">
      {st.phase === "idle" && (
        <>
          <Download className="h-4 w-4 shrink-0" />
          <span>Nouvelle version {version} disponible</span>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className={btn} onClick={() => void startUpdate(runtime)}>
              Mettre à jour
            </button>
            <button type="button" className={ghost} onClick={() => set({ dismissed: true })}>
              Plus tard
            </button>
          </div>
        </>
      )}
      {st.phase === "syncing" && (
        <>
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <span>Synchronisation avant la mise à jour…</span>
        </>
      )}
      {st.phase === "confirm" && (
        <>
          <AlertTriangle className="h-4 w-4 shrink-0 text-warn" />
          <span className="min-w-0 flex-1">Des modifications ne sont pas encore synchronisées : elles seront conservées et envoyées après la mise à jour.</span>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className={btn} onClick={() => void download()}>
              Continuer
            </button>
            <button type="button" className={ghost} onClick={() => set({ phase: "idle" })}>
              Annuler
            </button>
          </div>
        </>
      )}
      {st.phase === "downloading" && (
        <>
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <span>Téléchargement de la version {version}{pct !== null ? ` : ${pct} %` : "…"}</span>
          {pct !== null && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-brand-100 sm:ml-auto sm:w-48">
              <div className="h-full bg-brand-600 transition-[width]" style={{ width: `${pct}%` }} />
            </div>
          )}
        </>
      )}
      {st.phase === "installing" && (
        <>
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <span>Installation… l&apos;application va redémarrer.</span>
        </>
      )}
      {st.phase === "error" && (
        <>
          <AlertTriangle className="h-4 w-4 shrink-0 text-danger" />
          <span className="min-w-0 flex-1 text-danger">{st.error}</span>
          <div className="ml-auto flex items-center gap-2">
            {st.info?.available && (
              <button type="button" className={btn} onClick={() => void startUpdate(runtime)}>
                Réessayer
              </button>
            )}
            <button type="button" className={ghost} onClick={() => set({ phase: "idle", error: null, dismissed: true })} aria-label="Fermer">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
