"use client";

import { useEffect, useState } from "react";
import { BookHeart, CalendarDays, Check, Copy, Loader2, Moon, RefreshCw, Trash2 } from "lucide-react";
import { api, serverOriginOf } from "@/lib/client";
import type { ProfileDto } from "@/lib/users";
import type { CalendarFeedStatus } from "@/lib/calendar-feed";
import { JOURNAL_BLOCKS, JOURNAL_BLOCK_HINT, JOURNAL_BLOCK_LABEL, type JournalBlockKey } from "@/lib/shared/journal";
import { Button, Toggle, errorMessage, inputClass, toast } from "@/components/ui";

/**
 * Préférences — « Fraîcheur » (seuil d'inactivité des tâches et projets
 * endormis), « Personnalisation du journal » (blocs affichés) et
 * « Calendrier » (abonnement iCal : Outlook, iPhone, Google).
 */

/** Blocs du journal quotidien affichés (enregistré à chaque bascule). */
export function JournalSection({ profile, onProfile }: { profile: ProfileDto; onProfile: (p: ProfileDto) => void }) {
  const [busy, setBusy] = useState<JournalBlockKey | null>(null);
  const enabled = new Set(profile.journalBlocks);

  async function toggle(block: JournalBlockKey, on: boolean) {
    const next = JOURNAL_BLOCKS.filter((b) => (b === block ? on : enabled.has(b)));
    setBusy(block);
    try {
      const { profile: p } = await api.patch<{ profile: ProfileDto }>("/me", { journalBlocks: next });
      onProfile(p);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section id="journal" className="mt-6 scroll-mt-20 rounded-2xl border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <BookHeart className="h-5 w-5 text-brand-600" /> Personnalisation du journal
      </h2>
      <p className="mt-1 text-sm text-muted">
        Blocs affichés dans le <a href="/journal" className="text-brand-600 hover:underline">journal quotidien</a>. Désactiver un bloc le masque sans effacer ce que vous y avez écrit.
      </p>
      <ul className="mt-3 divide-y divide-line">
        {JOURNAL_BLOCKS.map((b) => (
          <li key={b} className="flex items-center justify-between gap-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-sm font-medium">{JOURNAL_BLOCK_LABEL[b]}</span>
              <span className="block text-xs text-muted">{JOURNAL_BLOCK_HINT[b]}</span>
            </span>
            <span className="flex items-center gap-2">
              {busy === b && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
              <Toggle checked={enabled.has(b)} onChange={(v) => void toggle(b, v)} label={`Afficher « ${JOURNAL_BLOCK_LABEL[b]} »`} disabled={busy !== null} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FreshnessSection({ profile, onProfile }: { profile: ProfileDto; onProfile: (p: ProfileDto) => void }) {
  const [days, setDays] = useState(String(profile.staleDays));
  const [busy, setBusy] = useState(false);
  const n = Number(days);
  const valid = Number.isInteger(n) && n >= 1 && n <= 365;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      const { profile: p } = await api.patch<{ profile: ProfileDto }>("/me", { staleDays: n });
      onProfile(p);
      toast("Seuil de fraîcheur enregistré.", "ok");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="fraicheur" className="mt-6 scroll-mt-20 rounded-2xl border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <Moon className="h-5 w-5 text-brand-600" /> Fraîcheur
      </h2>
      <p className="mt-1 text-sm text-muted">
        Une tâche ouverte ou un projet actif sans aucune activité (modification, commentaire, session, réunion, document…) depuis ce nombre de jours est
        signalé « endormi » : tableau de bord, liste des projets et plan.
      </p>
      <form onSubmit={save} className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="stale-days" className="text-sm font-medium">
          Endormi après
        </label>
        <input id="stale-days" type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} className={`${inputClass} w-24`} />
        <span className="text-sm text-muted">jours sans activité</span>
        <Button type="submit" size="sm" disabled={!valid || busy || n === profile.staleDays}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Enregistrer
        </Button>
      </form>
    </section>
  );
}

export function CalendarSection() {
  const [feed, setFeed] = useState<CalendarFeedStatus | null>(null);
  const [offline, setOffline] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .get<{ feed: CalendarFeedStatus }>("/me/calendar")
      .then((r) => setFeed(r.feed))
      .catch(() => setOffline(true));
  }, []);

  async function generate() {
    if (feed?.active && !window.confirm("Générer une nouvelle adresse ? L'ancienne cessera de fonctionner dans les agendas abonnés.")) return;
    setBusy(true);
    try {
      const r = await api.post<{ path: string; feed: CalendarFeedStatus }>("/me/calendar");
      setFeed(r.feed);
      setUrl(serverOriginOf(window.location.origin) + r.path);
      setCopied(false);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!window.confirm("Désactiver le flux ? Les agendas abonnés ne recevront plus vos échéances.")) return;
    setBusy(true);
    try {
      await api.delete("/me/calendar");
      setFeed({ active: false, createdAt: null, lastUsedAt: null });
      setUrl(null);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      toast("Copie impossible : sélectionnez l'adresse à la main.", "error");
    }
  }

  if (offline) return null;
  const webcal = url?.replace(/^https?:/, "webcal:");

  return (
    <section id="calendrier" className="mt-6 scroll-mt-20 rounded-2xl border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <CalendarDays className="h-5 w-5 text-brand-600" /> Calendrier (abonnement iCal)
      </h2>
      <p className="mt-1 text-sm text-muted">
        Abonnez Outlook, l&apos;iPhone ou Google Agenda à vos échéances de tâches, sessions de travail, réunions et livrables. L&apos;agenda se met à jour
        tout seul (environ toutes les heures) ; il est en lecture seule.
      </p>
      {feed === null ? (
        <Loader2 className="mt-3 h-5 w-5 animate-spin text-muted" />
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void generate()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : feed.active ? <RefreshCw className="h-4 w-4" /> : <CalendarDays className="h-4 w-4" />}
              {feed.active ? "Générer une nouvelle adresse" : "Créer mon adresse d'abonnement"}
            </Button>
            {feed.active && (
              <Button size="sm" variant="ghost" onClick={() => void revoke()} disabled={busy}>
                <Trash2 className="h-4 w-4" /> Désactiver
              </Button>
            )}
            {feed.active && (
              <span className="text-xs text-muted">
                Active depuis le {new Date(feed.createdAt!).toLocaleDateString("fr-FR")}
                {feed.lastUsedAt ? ` · dernière lecture le ${new Date(feed.lastUsedAt).toLocaleString("fr-FR")}` : " · jamais lue"}
              </span>
            )}
          </div>
          {url && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="font-medium text-amber-900">Adresse secrète : copiez-la maintenant, elle ne sera plus affichée.</p>
              <div className="mt-2 flex gap-2">
                <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className={`${inputClass} min-w-0 flex-1 font-mono text-xs`} aria-label="Adresse du flux iCal" />
                <Button size="sm" variant="outline" onClick={() => void copy()}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copiée" : "Copier"}
                </Button>
              </div>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-amber-900">
                <li>
                  Outlook : Calendrier › Ajouter un calendrier › <em>S&apos;abonner à partir du web</em>, puis collez l&apos;adresse.
                </li>
                <li>
                  iPhone : Réglages › Calendrier › Comptes › Ajouter un compte › Autre › <em>Ajouter un calendrier avec abonnement</em>
                  {webcal && (
                    <>
                      {" "}
                      — ou{" "}
                      <a href={webcal} className="font-medium underline">
                        ouvrir directement
                      </a>
                    </>
                  )}
                  .
                </li>
                <li>Google Agenda : Autres agendas › + › À partir de l&apos;URL.</li>
              </ul>
              <p className="mt-2 text-xs text-amber-900">Quiconque connaît cette adresse voit ces évènements : ne la partagez pas. En cas de doute, générez-en une nouvelle.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
