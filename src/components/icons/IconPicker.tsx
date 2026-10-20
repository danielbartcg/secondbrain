"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Loader2, Search, Smile, Trash2, X } from "lucide-react";
import { LucideSvg, useIconData } from "./lucide-data";
import { api, uploadImage } from "@/lib/client";
import { LUCIDE_PREFIX } from "@/lib/shared/icons";
import type { UserIconDto } from "@/lib/user-icons";
import { errorMessage, toast } from "@/components/ui";

/**
 * Bibliothèque d'icônes (près de 1 900 icônes Lucide, données chargées à la demande)
 * et icônes personnalisées (images téléversées, gardées dans « Mes icônes »).
 * Recherche en anglais (noms des icônes) ou en français (mots courants).
 * Fenêtre modale ; tiroir bas sur mobile. `onPick(null)` retire l'icône.
 */

const PAGE = 240;

/** Mots français courants → termes des noms d'icônes (anglais). */
const FR: Record<string, string[]> = {
  accueil: ["home", "house"], maison: ["home", "house"], batiment: ["building"], bureau: ["building", "briefcase", "desk"], entreprise: ["building", "factory"],
  usine: ["factory"], client: ["user", "users", "handshake", "contact"], clients: ["users", "handshake"], equipe: ["users", "group"], personne: ["user"],
  marketing: ["megaphone", "target", "chart", "trending"], vente: ["shopping", "store", "badge-dollar", "receipt"], argent: ["dollar", "euro", "coins", "wallet", "banknote", "piggy"],
  finance: ["chart", "coins", "landmark", "wallet"], banque: ["landmark", "piggy"], budget: ["wallet", "calculator", "coins"], facture: ["receipt", "file"],
  projet: ["folder", "briefcase", "kanban", "rocket"], dossier: ["folder"], fichier: ["file"], document: ["file", "book"], livre: ["book"], idee: ["lightbulb", "sparkles", "brain"],
  cerveau: ["brain"], fusee: ["rocket"], lancement: ["rocket"], objectif: ["target", "goal", "flag"], drapeau: ["flag"], etoile: ["star"], coeur: ["heart"],
  sante: ["heart-pulse", "stethoscope", "pill", "hospital"], medecin: ["stethoscope"], sport: ["dumbbell", "bike", "trophy", "volleyball"], trophee: ["trophy"],
  voyage: ["plane", "luggage", "map", "globe"], avion: ["plane"], voiture: ["car"], train: ["train"], carte: ["map"], monde: ["globe", "earth"], terre: ["earth", "globe"],
  calendrier: ["calendar"], date: ["calendar"], horloge: ["clock"], temps: ["clock", "timer", "hourglass"], alarme: ["alarm"], cloche: ["bell"],
  message: ["message", "mail", "send"], courriel: ["mail"], email: ["mail"], telephone: ["phone", "smartphone"], appel: ["phone"], video: ["video", "camera"],
  photo: ["camera", "image"], image: ["image"], musique: ["music"], son: ["volume", "music"], micro: ["mic"], code: ["code", "terminal", "braces"],
  informatique: ["laptop", "monitor", "cpu", "server"], ordinateur: ["laptop", "monitor"], serveur: ["server", "database"], donnees: ["database", "chart"], base: ["database"],
  securite: ["shield", "lock", "key"], cadenas: ["lock"], cle: ["key"], outil: ["wrench", "hammer", "tool", "settings"], reglage: ["settings", "sliders"],
  recherche: ["search", "flask", "microscope"], science: ["flask", "atom", "microscope"], ecole: ["school", "graduation"], formation: ["graduation", "book-open", "presentation"],
  jardin: ["flower", "leaf", "sprout", "tree"], nature: ["leaf", "tree", "mountain", "sun"], plante: ["sprout", "leaf"], arbre: ["tree"], fleur: ["flower"], soleil: ["sun"],
  lune: ["moon"], nuage: ["cloud"], pluie: ["cloud-rain", "umbrella"], feu: ["flame"], eau: ["droplet", "waves"], energie: ["zap", "battery", "plug"], eclair: ["zap"],
  cuisine: ["chef", "utensils", "cooking"], repas: ["utensils", "pizza", "salad"], cafe: ["coffee"], cadeau: ["gift"], fete: ["party", "cake"], gateau: ["cake"],
  achat: ["shopping-cart", "shopping-bag"], panier: ["shopping-cart", "basket"], magasin: ["store"], livraison: ["truck", "package"], colis: ["package"], boite: ["box", "package"],
  juridique: ["scale", "gavel"], contrat: ["file-signature", "pen"], signature: ["signature", "pen"], tache: ["check", "list", "clipboard"], liste: ["list"], note: ["notebook", "sticky"],
  graphique: ["chart"], statistique: ["chart", "trending"], croissance: ["trending-up", "sprout"], risque: ["triangle-alert", "shield"], alerte: ["alert", "siren"],
  famille: ["users", "baby", "home"], enfant: ["baby"], animal: ["dog", "cat", "paw"], chien: ["dog"], chat: ["cat"], art: ["palette", "brush"], dessin: ["pencil", "brush"],
  jeu: ["gamepad", "dice", "puzzle"], puzzle: ["puzzle"], cible: ["target"], recrutement: ["user-plus", "briefcase"], rh: ["users", "id-card"], qualite: ["badge-check", "award"],
};

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

export function IconPicker({ value, title, onPick, onClose }: { value: string | null; title: string; onPick: (icon: string | null) => void; onClose: () => void }) {
  const [tab, setTab] = useState<"library" | "mine">(value && !value.startsWith(LUCIDE_PREFIX) ? "mine" : "library");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [mine, setMine] = useState<UserIconDto[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const data = useIconData();
  const iconNames = useMemo(() => (data ? Object.keys(data) : []), [data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    api
      .get<{ icons: UserIconDto[] }>("/me/icons")
      .then((r) => setMine(r.icons))
      .catch(() => setMine([]));
  }, []);

  const results = useMemo(() => {
    const q = fold(query);
    if (!q) return iconNames;
    const terms = [q, ...Object.entries(FR).flatMap(([fr, en]) => (fr.startsWith(q) || (q.length >= 4 && q.startsWith(fr)) ? en : []))];
    return iconNames.filter((n) => terms.some((t) => n.includes(t)));
  }, [query, iconNames]);

  useEffect(() => setLimit(PAGE), [query]);

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) {
      toast("Image PNG, JPEG, GIF ou WebP uniquement.", "error");
      return;
    }
    setUploading(true);
    try {
      const url = await uploadImage(file);
      if (!url) throw new Error("Téléversement impossible.");
      const r = await api.post<{ icons: UserIconDto[] }>("/me/icons", { url });
      setMine(r.icons);
      onPick(url);
    } catch (e) {
      toast(errorMessage(e, "Téléversement impossible (en ligne uniquement)."), "error");
    } finally {
      setUploading(false);
    }
  }

  async function removeMine(icon: UserIconDto) {
    try {
      setMine((await api.delete<{ icons: UserIconDto[] }>(`/me/icons/${icon.id}`)).icons);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  const tabBtn = (id: typeof tab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`rounded-full px-3 py-1.5 text-sm font-medium ${tab === id ? "bg-brand-600 text-on-brand" : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="icon-picker-title" className="flex h-[85dvh] w-full max-w-2xl flex-col rounded-t-2xl bg-surface shadow-xl sm:h-[36rem] sm:rounded-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Smile className="h-5 w-5 shrink-0 text-brand-600" />
          <h2 id="icon-picker-title" className="min-w-0 flex-1 truncate text-lg font-semibold">
            Icône · {title}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface-2" aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3" role="tablist">
          {tabBtn("library", `Bibliothèque (${iconNames.length.toLocaleString("fr-FR")})`)}
          {tabBtn("mine", `Mes icônes${mine?.length ? ` (${mine.length})` : ""}`)}
          {value && (
            <button type="button" onClick={() => onPick(null)} className="ml-auto rounded-full px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-danger">
              Retirer l&apos;icône
            </button>
          )}
        </div>

        {tab === "library" ? (
          <>
            <label className="relative mx-4 mt-3 block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher (ex. fusée, client, rocket, chart…)"
                aria-label="Rechercher une icône"
                className="w-full rounded-lg border border-line-strong bg-surface py-2 pl-9 pr-3 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 sm:text-sm"
              />
            </label>
            <p className="px-4 pt-1.5 text-xs text-muted">
              {results.length.toLocaleString("fr-FR")} icône{results.length > 1 ? "s" : ""}
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-1">
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1">
                {results.slice(0, limit).map((n) => {
                  const v = `${LUCIDE_PREFIX}${n}`;
                  return (
                    <li key={n}>
                      <button
                        type="button"
                        onClick={() => onPick(v)}
                        title={n}
                        aria-label={n}
                        aria-pressed={value === v}
                        className={`flex aspect-square w-full items-center justify-center rounded-lg text-ink-2 hover:bg-brand-50 hover:text-brand-700 ${value === v ? "bg-brand-600 text-on-brand hover:bg-brand-600 hover:text-on-brand" : ""}`}
                      >
                        <LucideSvg nodes={data![n]} className="h-5 w-5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              {results.length > limit && (
                <button type="button" onClick={() => setLimit((l) => l + PAGE * 2)} className="mx-auto mt-3 block rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink-2 hover:bg-surface-2">
                  Afficher plus ({(results.length - limit).toLocaleString("fr-FR")} restantes)
                </button>
              )}
              {!data && <p className="py-8 text-center text-sm text-muted">Chargement de la bibliothèque…</p>}
              {data && results.length === 0 && <p className="py-8 text-center text-sm text-muted">Aucune icône ne correspond. Essayez un mot anglais (ex. « rocket »).</p>}
            </div>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => void upload(e.target.files).finally(() => (e.target.value = ""))} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong px-4 py-4 text-sm font-medium text-ink-2 hover:bg-surface-2 disabled:opacity-60"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} Importer une icône (PNG, JPEG, GIF, WebP — carrée de préférence)
            </button>
            {mine === null ? (
              <p className="mt-4 text-center text-sm text-muted">Chargement…</p>
            ) : mine.length === 0 ? (
              <p className="mt-4 text-center text-sm text-muted">Aucune icône personnalisée pour l&apos;instant.</p>
            ) : (
              <ul className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] gap-2">
                {mine.map((ic) => (
                  <li key={ic.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => onPick(ic.url)}
                      aria-pressed={value === ic.url}
                      className={`flex aspect-square w-full items-center justify-center rounded-xl border p-2 hover:border-brand-500 ${value === ic.url ? "border-brand-600 ring-2 ring-brand-500" : "border-line"}`}
                      aria-label="Choisir cette icône"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={ic.url} alt="" className="h-full w-full rounded object-contain" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeMine(ic)}
                      className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-surface p-1 text-faint shadow ring-1 ring-line hover:text-danger group-hover:block max-md:block"
                      aria-label="Retirer de mes icônes"
                      title="Retirer de mes icônes (les projets et cartes qui l'utilisent la gardent)"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
