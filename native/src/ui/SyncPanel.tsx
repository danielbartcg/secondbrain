import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AlertTriangle, CloudOff, Loader2, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { isForcedOffline, setForcedOffline } from "../local/remote";
import type { SyncEngine } from "../local/sync";
import type { SyncStatus } from "../local/types";

/** Statut de synchronisation (abonnement au moteur). */
export function useSyncStatus(sync: SyncEngine): SyncStatus {
  return useSyncExternalStore(
    (l) => sync.subscribe(l),
    () => sync.status,
    () => sync.status,
  );
}

function ago(iso: string | null): string {
  if (!iso) return "jamais";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 10) return "à l'instant";
  if (s < 60) return `il y a ${s} s`;
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Encart d'état de la synchronisation (au-dessus du menu) : en ligne / hors
 * ligne, modifications en attente, dernière synchro, conflits, bouton
 * « Synchroniser » et bascule « Travailler hors ligne ».
 */
export function SyncPanel({ sync }: { sync: SyncEngine }) {
  const st = useSyncStatus(sync);
  const [, tick] = useState(0);
  const [forced, setForced] = useState(isForcedOffline());
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 15_000);
    return () => clearInterval(t);
  }, []);
  const offline = forced || !st.online;

  return (
    <div className="mb-3 rounded-xl border border-line bg-surface-2/60 p-2.5 text-xs">
      <div className="flex items-center gap-2">
        {st.syncing ? (
          <Loader2 className="h-4 w-4 animate-spin text-brand-600" />
        ) : offline ? (
          <WifiOff className="h-4 w-4 text-warn" />
        ) : (
          <Wifi className="h-4 w-4 text-ok" />
        )}
        <span className="font-medium text-ink">{st.syncing ? "Synchronisation…" : forced ? "Hors ligne (choisi)" : offline ? "Hors ligne" : "En ligne"}</span>
        <button
          type="button"
          onClick={() => void sync.syncNow()}
          disabled={st.syncing || forced}
          className="ml-auto rounded-md p-1 text-muted hover:bg-surface-3 hover:text-ink disabled:opacity-40"
          title="Synchroniser maintenant"
          aria-label="Synchroniser maintenant"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1 text-muted">
        {st.pending > 0 ? `${st.pending} modification${st.pending > 1 ? "s" : ""} en attente` : "Tout est synchronisé"} · {ago(st.lastSyncAt)}
      </p>
      {st.lastError && !offline && <p className="mt-1 text-danger">{st.lastError}</p>}
      <div className="mt-1.5 flex items-center gap-2">
        {st.conflicts > 0 && (
          <Link href="/conflicts" className="flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800 hover:underline">
            <AlertTriangle className="h-3 w-3" /> {st.conflicts} conflit{st.conflicts > 1 ? "s" : ""}
          </Link>
        )}
        <label className="ml-auto flex cursor-pointer items-center gap-1 text-muted" title="Ne plus contacter le serveur (tout reste modifiable, la synchro reprendra en décochant)">
          <input
            type="checkbox"
            checked={forced}
            onChange={(e) => {
              setForcedOffline(e.target.checked);
              setForced(e.target.checked);
              if (!e.target.checked) void sync.syncNow();
            }}
            className="accent-brand-600"
          />
          <CloudOff className="h-3 w-3" /> Hors ligne
        </label>
      </div>
    </div>
  );
}
