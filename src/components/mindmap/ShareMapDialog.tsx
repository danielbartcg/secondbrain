"use client";

import { useEffect, useRef, useState } from "react";
import { Share2, Trash2, X } from "lucide-react";
import { api } from "@/lib/client";
import type { MapSharesDto } from "@/lib/map-shares";
import type { ContactDto } from "@/lib/messages";
import type { MapPermission } from "@/lib/shared/map-access";
import { Avatar, Button, errorMessage, inputClass, selectClass } from "@/components/ui";

/**
 * Partage d'une carte mentale (propriétaire) : choix des personnes (contacts
 * de la messagerie, ou adresse e-mail exacte d'un compte), droit Lecture /
 * Écriture, puis liste des partages en cours (changement de droit, retrait).
 * Fenêtre modale accessible (role=dialog, Échap), tiroir bas sur mobile.
 */
export function ShareMapDialog({
  mapId,
  mapTitle,
  onClose,
  onCount,
}: {
  mapId: string;
  mapTitle: string;
  onClose: () => void;
  /** Nombre de personnes après chaque modification (badge de l'en-tête). */
  onCount?: (count: number) => void;
}) {
  const [shares, setShares] = useState<MapSharesDto["shares"] | null>(null);
  const [contacts, setContacts] = useState<ContactDto[] | null>(null);
  const [selected, setSelected] = useState<ContactDto[]>([]);
  const [permission, setPermission] = useState<MapPermission>("READ");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const onCountRef = useRef(onCount);
  onCountRef.current = onCount;
  const base = `/mindmaps/${mapId}/shares`;

  const apply = (r: MapSharesDto) => {
    setShares(r.shares);
    onCountRef.current?.(r.shares.length);
  };

  useEffect(() => {
    api
      .get<MapSharesDto>(base)
      .then(apply)
      .catch((e) => setError(errorMessage(e)));
    api
      .get<{ contacts: ContactDto[] }>("/messages/contacts")
      .then((r) => setContacts(r.contacts))
      .catch(() => setContacts([]));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [base, onClose]);

  const q = query.trim().toLowerCase();
  const sharedIds = new Set((shares ?? []).map((s) => s.userId));
  const filtered = (contacts ?? []).filter((c) => !sharedIds.has(c.id) && (!q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)));
  const toggle = (c: ContactDto) => setSelected((s) => (s.some((x) => x.id === c.id) ? s.filter((x) => x.id !== c.id) : [...s, c]));
  const looksLikeEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(query.trim());

  async function lookup() {
    setLookupMsg(null);
    try {
      const { user } = await api.get<{ user: { id: string; name: string; email: string } | null }>(`/users/lookup?email=${encodeURIComponent(query.trim())}`);
      if (!user) return setLookupMsg("Aucun compte avec cette adresse.");
      if (sharedIds.has(user.id)) return setLookupMsg("Cette personne a déjà accès à la carte.");
      const c = { ...user, avatarUrl: null };
      setContacts((list) => (list && !list.some((x) => x.id === c.id) ? [c, ...list] : list));
      setSelected((s) => (s.some((x) => x.id === c.id) ? s : [...s, c]));
      setQuery("");
    } catch (e) {
      setLookupMsg(errorMessage(e));
    }
  }

  async function share() {
    if (busy || selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      let last: MapSharesDto | null = null;
      for (const c of selected) last = await api.post<MapSharesDto>(base, { userId: c.id, permission });
      if (last) apply(last);
      setSelected([]);
    } catch (e) {
      setError(errorMessage(e, "Partage impossible."));
      api.get<MapSharesDto>(base).then(apply).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function change(userId: string, p: MapPermission) {
    setError(null);
    try {
      apply(await api.patch<MapSharesDto>(`${base}/${userId}`, { permission: p }));
    } catch (e) {
      setError(errorMessage(e, "Modification impossible."));
    }
  }

  async function remove(userId: string, name: string) {
    if (!confirm(`Retirer l'accès de ${name} à cette carte ?`)) return;
    setError(null);
    try {
      apply(await api.delete<MapSharesDto>(`${base}/${userId}`));
    } catch (e) {
      setError(errorMessage(e, "Retrait impossible."));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="share-map-title" className="flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Share2 className="h-5 w-5 shrink-0 text-brand-600" />
          <h2 id="share-map-title" className="min-w-0 flex-1 truncate text-lg font-semibold">
            Partager « {mapTitle} »
          </h2>
          <button type="button" onClick={onClose} aria-label="Fermer" className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {selected.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {selected.map((c) => (
                <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 py-0.5 pl-0.5 pr-2 text-sm text-brand-700">
                  <Avatar id={c.id} name={c.name} src={c.avatarUrl} size={22} />
                  {c.name}
                  <button type="button" onClick={() => toggle(c)} aria-label={`Retirer ${c.name}`} className="rounded-full p-0.5 hover:bg-brand-100">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <label className="block text-sm font-medium" htmlFor="share-map-search">
            Ajouter des personnes
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="share-map-search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLookupMsg(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && looksLikeEmail && filtered.length === 0) {
                  e.preventDefault();
                  void lookup();
                }
              }}
              placeholder="Nom ou adresse e-mail"
              className={`${inputClass} min-w-0 flex-1`}
              autoFocus
            />
            {looksLikeEmail && filtered.length === 0 && (
              <Button variant="outline" onClick={() => void lookup()}>
                Ajouter
              </Button>
            )}
          </div>
          {lookupMsg && <p className="mt-1 text-xs text-danger">{lookupMsg}</p>}
          <ul className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-line">
            {contacts === null && <li className="px-3 py-2 text-sm text-muted">Chargement…</li>}
            {contacts !== null && filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted">{q ? "Aucun contact ne correspond. Saisissez l'adresse e-mail exacte d'un compte pour l'ajouter." : "Aucun contact : saisissez l'adresse e-mail d'un compte."}</li>
            )}
            {filtered.map((c) => {
              const on = selected.some((x) => x.id === c.id);
              return (
                <li key={c.id}>
                  <label className={`flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-2 ${on ? "bg-brand-50" : ""}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(c)} className="h-4 w-4 accent-[var(--color-brand-600)]" />
                    <Avatar id={c.id} name={c.name} src={c.avatarUrl} size={28} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{c.name}</span>
                      <span className="block truncate text-xs text-muted">{c.email}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="share-map-permission" className="text-sm font-medium">
              Droit
            </label>
            <select id="share-map-permission" value={permission} onChange={(e) => setPermission(e.target.value as MapPermission)} className={selectClass}>
              <option value="READ">Lecture</option>
              <option value="WRITE">Écriture</option>
            </select>
            <span className="text-xs text-muted">{permission === "READ" ? "Consultation seule." : "Peut modifier les nœuds et les notes."}</span>
            <Button className="ml-auto" onClick={() => void share()} disabled={busy || selected.length === 0}>
              {busy ? "Partage…" : "Partager"}
            </Button>
          </div>

          {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}

          <h3 className="mt-5 text-sm font-semibold">Personnes ayant accès</h3>
          {shares === null ? (
            <p className="mt-1 text-sm text-muted">Chargement…</p>
          ) : shares.length === 0 ? (
            <p className="mt-1 text-sm text-muted">Cette carte n&apos;est partagée avec personne.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
              {shares.map((s) => (
                <li key={s.userId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <Avatar id={s.userId} name={s.name} src={s.avatarUrl} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{s.name}</span>
                    <span className="block truncate text-xs text-muted">{s.email}</span>
                  </span>
                  <select
                    value={s.permission}
                    onChange={(e) => void change(s.userId, e.target.value as MapPermission)}
                    aria-label={`Droit de ${s.name}`}
                    className={selectClass}
                  >
                    <option value="READ">Lecture</option>
                    <option value="WRITE">Écriture</option>
                  </select>
                  <button type="button" onClick={() => void remove(s.userId, s.name)} title="Retirer l'accès" aria-label={`Retirer l'accès de ${s.name}`} className="rounded-lg p-2 text-faint hover:bg-red-50 hover:text-danger md:p-1.5">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end border-t border-line px-4 py-3">
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>
    </div>
  );
}
