"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CalendarClock, Check, CheckCircle2, Clock, MapPin, Plus, Trash2, Users, X, XCircle } from "lucide-react";
import { api } from "@/lib/client";
import type { ProjectDto } from "@/lib/projects";
import type { MeetingDto, MeetingStatus } from "@/lib/meetings";
import { RichTextEditor } from "@/components/RichTextEditor";
import { MemberMultiSelect } from "@/components/projects/MemberMultiSelect";
import { Avatar, Badge, Button, EmptyState, InlineEdit, errorMessage, inputClass, toast } from "@/components/ui";

/**
 * Onglet « Réunions » du projet : liste des réunions, création, compte-rendu
 * (texte riche, enregistrement automatique), participants, validateurs et
 * circuit de validation (valider / refuser avec motif). Toute modification
 * du compte-rendu par le rédacteur annule les décisions déjà prises.
 */

const STATUS: Record<MeetingStatus, { label: string; tone: "neutral" | "brand" | "ok" | "warn" | "danger" }> = {
  draft: { label: "Brouillon", tone: "neutral" },
  no_review: { label: "Sans validation", tone: "neutral" },
  pending: { label: "En validation", tone: "warn" },
  approved: { label: "Validé", tone: "ok" },
  rejected: { label: "Refusé", tone: "danger" },
};

type Resp = { meetings: MeetingDto[] };

/** Valeur pour <input type="datetime-local"> dans le fuseau du navigateur. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v: string) => new Date(v).toISOString();
const when = (iso: string) => new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function ProjectMeetingsTab({ project, currentUserId }: { project: ProjectDto; currentUserId: string }) {
  const [meetings, setMeetings] = useState<MeetingDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<Resp>(`/projects/${project.id}/meetings`);
      setMeetings(r.meetings);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, "Chargement impossible."));
    }
  }, [project.id]);

  useEffect(() => {
    void load();
    // Lien de notification : /projects/:id?meeting=<id>#reunions
    const m = new URLSearchParams(window.location.search).get("meeting");
    if (m) setSelected(m);
  }, [load]);

  const current = meetings?.find((m) => m.id === selected) ?? null;
  const toReview = (meetings ?? []).filter((m) => m.myDecision === "PENDING" && m.status !== "draft").length;

  return (
    <section className="grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
      {/* Liste */}
      <div className={`rounded-2xl border border-line bg-surface ${current || creating ? "hidden md:block" : ""}`}>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="flex flex-1 items-center gap-2 font-semibold">
            <CalendarClock className="h-5 w-5 text-brand-600" /> Réunions
          </h2>
          <Button size="sm" onClick={() => { setCreating(true); setSelected(null); }}>
            <Plus className="h-4 w-4" /> Nouvelle
          </Button>
        </div>
        {toReview > 0 && <p className="mx-3 mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{toReview} compte{toReview > 1 ? "s-rendus attendent" : "-rendu attend"} votre validation.</p>}
        {error && <p className="m-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}
        {meetings === null && !error && <p className="p-4 text-sm text-muted">Chargement…</p>}
        {meetings?.length === 0 && (
          <div className="p-4">
            <EmptyState title="Aucune réunion" hint="Créez une réunion pour en rédiger le compte-rendu et le faire valider." />
          </div>
        )}
        <ul className="max-h-[70vh] overflow-y-auto">
          {meetings?.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => { setSelected(m.id); setCreating(false); }}
                aria-current={m.id === selected ? "true" : undefined}
                className={`flex w-full flex-col gap-1 border-b border-line px-4 py-3 text-left transition-colors ${m.id === selected ? "bg-brand-50" : "hover:bg-surface-2"}`}
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.title}</span>
                  <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
                </span>
                <span className="text-xs text-muted">{when(m.date)}</span>
                {m.myDecision === "PENDING" && m.status !== "draft" && <span className="text-xs font-medium text-amber-700">À valider par vous</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Détail / création */}
      <div className={current || creating ? "" : "hidden md:block"}>
        {creating ? (
          <NewMeeting
            project={project}
            onCancel={() => setCreating(false)}
            onCreated={(list) => {
              setMeetings(list);
              setCreating(false);
              setSelected(list[0]?.id ?? null);
            }}
          />
        ) : current ? (
          <MeetingDetail key={current.id} project={project} meeting={current} currentUserId={currentUserId} onBack={() => setSelected(null)} onChange={setMeetings} />
        ) : (
          <div className="hidden h-full items-center justify-center rounded-2xl border border-dashed border-line p-10 text-sm text-muted md:flex">Choisissez une réunion ou créez-en une.</div>
        )}
      </div>
    </section>
  );
}

// --- Création ----------------------------------------------------------------------------------------

function NewMeeting({ project, onCancel, onCreated }: { project: ProjectDto; onCancel: () => void; onCreated: (list: MeetingDto[]) => void }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return toLocalInput(d.toISOString());
  });
  const [location, setLocation] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const [approvers, setApprovers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const withAccount = project.members.filter((m) => m.userId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !title.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<Resp>(`/projects/${project.id}/meetings`, { title, date: fromLocalInput(date), location, participantIds: participants, approverIds: approvers });
      onCreated(r.meetings);
    } catch (err) {
      toast(errorMessage(err, "Création impossible."), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <h2 className="font-semibold">Nouvelle réunion</h2>
      <label className="block text-sm font-medium">
        Titre
        <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} placeholder="Ex. Comité de pilotage n°3" className={`${inputClass} mt-1 w-full`} autoFocus />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Date et heure
          <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} required className={`${inputClass} mt-1 w-full`} />
        </label>
        <label className="block text-sm font-medium">
          Lieu <span className="font-normal text-muted">(facultatif)</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} placeholder="Salle, visio…" className={`${inputClass} mt-1 w-full`} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="text-sm font-medium">
          Participants
          <div className="mt-1">
            <MemberMultiSelect members={project.members} value={participants} onChange={setParticipants} />
          </div>
        </div>
        <div className="text-sm font-medium">
          Validateurs du compte-rendu
          <div className="mt-1">
            <MemberMultiSelect members={withAccount} value={approvers} onChange={setApprovers} />
          </div>
          <p className="mt-1 text-xs font-normal text-muted">Seuls les membres rattachés à un compte peuvent valider.</p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="submit" disabled={busy || !title.trim()}>
          {busy ? "Création…" : "Créer la réunion"}
        </Button>
      </div>
    </form>
  );
}

// --- Détail ------------------------------------------------------------------------------------------

function MeetingDetail({
  project,
  meeting,
  currentUserId,
  onBack,
  onChange,
}: {
  project: ProjectDto;
  meeting: MeetingDto;
  currentUserId: string;
  onBack: () => void;
  onChange: (list: MeetingDto[]) => void;
}) {
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const withAccount = useMemo(() => project.members.filter((m) => m.userId), [project.members]);
  const editable = meeting.canEdit;

  const patch = useCallback(
    async (data: Record<string, unknown>) => {
      try {
        const r = await api.patch<Resp>(`/meetings/${meeting.id}`, data);
        onChange(r.meetings);
        return true;
      } catch (e) {
        toast(errorMessage(e, "Enregistrement impossible."), "error");
        return false;
      }
    },
    [meeting.id, onChange],
  );

  /** Compte-rendu : enregistrement automatique 1,2 s après la dernière frappe. */
  const flushMinutes = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const html = pending.current;
    if (html === null) return;
    pending.current = null;
    setSaving("saving");
    const ok = await patch({ minutes: html });
    setSaving(ok ? "saved" : "error");
    if (!ok) pending.current = html;
  }, [patch]);

  useEffect(
    () => () => {
      // Départ de la réunion : on enregistre ce qui reste.
      if (pending.current !== null) void flushMinutes();
    },
    [flushMinutes],
  );

  function onMinutes(html: string) {
    pending.current = html;
    setSaving("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushMinutes(), 1200);
  }

  async function remove() {
    if (!confirm(`Supprimer la réunion « ${meeting.title} » et son compte-rendu ?`)) return;
    try {
      const r = await api.delete<Resp>(`/meetings/${meeting.id}`);
      onChange(r.meetings);
      onBack();
    } catch (e) {
      toast(errorMessage(e, "Suppression impossible."), "error");
    }
  }

  const approvedCount = meeting.approvers.filter((a) => a.decision === "APPROVED").length;
  const isApprover = meeting.myDecision !== null;

  return (
    <article className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2 md:hidden">
        <button type="button" onClick={onBack} className="flex items-center gap-1 rounded-lg p-1.5 text-sm text-muted hover:bg-surface-2 hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Réunions
        </button>
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          {editable ? (
            <InlineEdit value={meeting.title} onSave={(title) => void patch({ title })} as="h2" className="-mx-1.5 block text-xl font-semibold" />
          ) : (
            <h2 className="text-xl font-semibold">{meeting.title}</h2>
          )}
          <p className="mt-0.5 text-xs text-muted">
            Rédacteur : {meeting.authorName}
            {meeting.minutesUpdatedAt && ` · compte-rendu modifié le ${when(meeting.minutesUpdatedAt)}`}
          </p>
        </div>
        <Badge tone={STATUS[meeting.status].tone}>{STATUS[meeting.status].label}</Badge>
        {editable && (
          <button type="button" onClick={() => void remove()} aria-label="Supprimer la réunion" title="Supprimer la réunion" className="rounded-lg p-2 text-muted hover:bg-red-50 hover:text-danger md:p-1.5">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Date, lieu */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4 shrink-0 text-muted" />
          {editable ? (
            <input type="datetime-local" defaultValue={toLocalInput(meeting.date)} onBlur={(e) => e.target.value && e.target.value !== toLocalInput(meeting.date) && void patch({ date: fromLocalInput(e.target.value) })} aria-label="Date et heure" className={`${inputClass} w-full`} />
          ) : (
            <span>{when(meeting.date)}</span>
          )}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-muted" />
          {editable ? (
            <input defaultValue={meeting.location} onBlur={(e) => e.target.value !== meeting.location && void patch({ location: e.target.value })} placeholder="Lieu" maxLength={200} aria-label="Lieu" className={`${inputClass} w-full`} />
          ) : (
            <span>{meeting.location || "—"}</span>
          )}
        </label>
      </div>

      {/* Participants et validateurs */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <Users className="h-3.5 w-3.5" /> Participants ({meeting.participants.length})
          </h3>
          {editable ? (
            <MemberMultiSelect members={project.members} value={meeting.participants.map((p) => p.memberId)} onChange={(ids) => void patch({ participantIds: ids })} />
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {meeting.participants.map((p) => (
                <li key={p.memberId} className="flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pl-0.5 pr-2 text-sm">
                  <Avatar id={p.memberId} name={p.name} src={p.avatarUrl} size={20} /> {p.name}
                </li>
              ))}
              {meeting.participants.length === 0 && <li className="text-sm text-muted">Aucun.</li>}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <CheckCircle2 className="h-3.5 w-3.5" /> Validation ({approvedCount}/{meeting.approvers.length})
          </h3>
          {editable && <MemberMultiSelect members={withAccount} value={meeting.approvers.map((a) => a.memberId)} onChange={(ids) => void patch({ approverIds: ids })} />}
          <ul className="mt-2 flex flex-col gap-1.5">
            {meeting.approvers.map((a) => (
              <li key={a.memberId} className="rounded-lg border border-line px-2.5 py-1.5 text-sm">
                <div className="flex items-center gap-2">
                  <Avatar id={a.memberId} name={a.name} src={a.avatarUrl} size={22} />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  {a.decision === "APPROVED" ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-ok">
                      <Check className="h-3.5 w-3.5" /> Validé
                    </span>
                  ) : a.decision === "REJECTED" ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-danger">
                      <XCircle className="h-3.5 w-3.5" /> Refusé
                    </span>
                  ) : (
                    <span className="text-xs text-muted">En attente</span>
                  )}
                </div>
                {a.comment && <p className="mt-1 whitespace-pre-wrap pl-7 text-xs text-ink-2">« {a.comment} »</p>}
              </li>
            ))}
            {meeting.approvers.length === 0 && <li className="text-sm text-muted">Aucun validateur : le compte-rendu n&apos;est pas soumis à validation.</li>}
          </ul>
        </div>
      </div>

      {/* Ma décision */}
      {isApprover && <DecisionPanel meeting={meeting} onChange={onChange} />}

      {/* Compte-rendu */}
      <div className="mt-5">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Compte-rendu</h3>
          {editable && (
            <span className={`ml-auto text-xs ${saving === "error" ? "text-danger" : saving === "saving" ? "text-warn" : "text-faint"}`} role="status">
              {saving === "saving" ? "Enregistrement…" : saving === "saved" ? "Enregistré" : saving === "error" ? "Erreur d'enregistrement" : ""}
            </span>
          )}
        </div>
        {editable ? (
          <>
            {meeting.approvers.length > 0 && meeting.approvers.some((a) => a.decision !== "PENDING") && (
              <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Modifier le compte-rendu annule les validations et refus déjà donnés : les validateurs seront de nouveau sollicités.</p>
            )}
            <RichTextEditor initialHtml={meeting.minutes} documentKey={meeting.id} onChange={onMinutes} minHeight={280} placeholder="Ordre du jour, échanges, décisions, actions… Collez des images, insérez des tableaux." />
          </>
        ) : meeting.minutes ? (
          // Contenu assaini côté serveur (sanitizeNotes dans lib/meetings.ts).
          <div className="prose max-w-none rounded-xl border border-line bg-surface-2/40 p-4" dangerouslySetInnerHTML={{ __html: meeting.minutes }} />
        ) : (
          <p className="text-sm text-muted">Le compte-rendu n&apos;est pas encore rédigé.</p>
        )}
        {!editable && meeting.authorId !== currentUserId && <p className="mt-2 text-xs text-muted">Seul le rédacteur ({meeting.authorName}) ou le propriétaire du projet peut modifier ce compte-rendu.</p>}
      </div>
    </article>
  );
}

function DecisionPanel({ meeting, onChange }: { meeting: MeetingDto; onChange: (list: MeetingDto[]) => void }) {
  const [refusing, setRefusing] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const empty = meeting.status === "draft";

  async function decide(decision: "APPROVED" | "REJECTED") {
    if (busy) return;
    if (decision === "REJECTED" && !comment.trim()) return toast("Expliquez pourquoi vous refusez le compte-rendu.", "error");
    setBusy(true);
    try {
      const r = await api.post<Resp>(`/meetings/${meeting.id}/decision`, { decision, comment });
      onChange(r.meetings);
      setRefusing(false);
      setComment("");
      toast(decision === "APPROVED" ? "Compte-rendu validé." : "Refus envoyé au rédacteur.", "ok");
    } catch (e) {
      toast(errorMessage(e, "Envoi impossible."), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-brand-500 bg-brand-50 p-3">
      <p className="text-sm font-medium text-brand-700">
        {empty
          ? "Vous êtes validateur : le compte-rendu n'est pas encore rédigé."
          : meeting.myDecision === "PENDING"
            ? "Votre validation est attendue."
            : meeting.myDecision === "APPROVED"
              ? "Vous avez validé ce compte-rendu."
              : "Vous avez refusé ce compte-rendu."}
      </p>
      {!empty && (
        <>
          {refusing ? (
            <div className="mt-2 space-y-2">
              <label className="block text-sm">
                Motif du refus
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={5000} autoFocus className={`${inputClass} mt-1 w-full`} placeholder="Ce qui doit être corrigé ou complété…" />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" onClick={() => void decide("REJECTED")} disabled={busy || !comment.trim()}>
                  <X className="h-4 w-4" /> Envoyer le refus
                </Button>
                <Button variant="ghost" onClick={() => setRefusing(false)}>
                  Annuler
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button onClick={() => void decide("APPROVED")} disabled={busy || meeting.myDecision === "APPROVED"}>
                <Check className="h-4 w-4" /> Valider
              </Button>
              <Button variant="outline" onClick={() => setRefusing(true)} disabled={busy}>
                <X className="h-4 w-4" /> Refuser…
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
