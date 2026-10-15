"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, CheckCheck, CornerUpLeft, EyeOff, LogOut, MessagesSquare, MoreHorizontal, Plus, Search, Send, Trash2, X } from "lucide-react";
import { api } from "@/lib/client";
import { Avatar, Button, EmptyState, inputClass } from "@/components/ui";
import { RichTextEditor } from "@/components/RichTextEditor";
import { refreshUnreadMessages } from "@/lib/messages-store";
import type { ContactDto, ConversationDto, ConversationSummaryDto, MessageDto, ParticipantDto } from "@/lib/messages";

/**
 * Messagerie interne : liste des conversations + fil (deux colonnes sur grand
 * écran, l'un ou l'autre sur mobile). Rafraîchissement périodique : le fil
 * ouvert toutes les 4 s (messages créés ou supprimés depuis), la liste toutes
 * les 15 s.
 */

export type MessagesUser = { id: string; name: string; avatarUrl: string | null };

const isBlank = (html: string) => !/<img\b/i.test(html) && html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim() === "";

export function conversationName(c: { title: string; participants: { id: string; name: string }[] }, meId: string): string {
  if (c.title) return c.title;
  const others = c.participants.filter((p) => p.id !== meId).map((p) => p.name);
  return others.length ? others.join(", ") : "Moi seul";
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const diffDays = (now.getTime() - d.getTime()) / 86400_000;
  if (diffDays < 6) return d.toLocaleDateString("fr-FR", { weekday: "short" });
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400_000);
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === yesterday.toDateString()) return "Hier";
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : "Une erreur est survenue.";
}

// --- Écran principal ---------------------------------------------------------------------------

export function MessagesApp({ me, conversationId }: { me: MessagesUser; conversationId?: string }) {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationSummaryDto[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");

  const loadList = useCallback(async () => {
    try {
      const r = await api.get<{ conversations: ConversationSummaryDto[] }>("/messages/conversations");
      setConversations(r.conversations);
      setListError(null);
    } catch (e) {
      setListError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void loadList();
    const t = setInterval(() => document.visibilityState === "visible" && void loadList(), 15_000);
    return () => clearInterval(t);
  }, [loadList]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!conversations || !q) return conversations ?? [];
    return conversations.filter((c) => conversationName(c, me.id).toLowerCase().includes(q));
  }, [conversations, filter, me.id]);

  const open = (id: string) => router.push(`/messages/${id}`);

  return (
    // Plein cadre (comme l'éditeur de carte) : la liste et le fil défilent chacun de leur côté.
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 md:h-dvh">
      {/* Liste des conversations (cachée sur mobile quand un fil est ouvert) */}
      <section className={`min-h-0 w-full flex-col border-line md:flex md:w-80 md:shrink-0 md:border-r ${conversationId ? "hidden" : "flex"}`} aria-label="Conversations">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h1 className="flex-1 text-xl font-semibold tracking-tight">Messages</h1>
          <Button onClick={() => setCreating(true)} className="!px-3" title="Nouvelle conversation">
            <Plus className="h-4 w-4" /> <span className="sm:inline">Nouveau</span>
          </Button>
        </div>
        <div className="border-b border-line px-3 py-2">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Rechercher une conversation" aria-label="Rechercher une conversation" className={`${inputClass} w-full pl-8`} />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {listError && <p className="m-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{listError}</p>}
          {conversations === null && !listError && <p className="p-4 text-sm text-muted">Chargement…</p>}
          {conversations?.length === 0 && (
            <div className="p-4">
              <EmptyState title="Aucune conversation" hint="Écrivez à un membre de vos projets avec « Nouveau ».">
                <Button onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" /> Nouvelle conversation
                </Button>
              </EmptyState>
            </div>
          )}
          <ul>
            {visible.map((c) => {
              const others = c.participants.filter((p) => p.id !== me.id);
              const active = c.id === conversationId;
              const unread = c.unreadCount > 0;
              return (
                <li key={c.id}>
                  <Link
                    href={`/messages/${c.id}`}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-3 border-b border-line px-4 py-3 transition-colors ${active ? "bg-brand-50" : "hover:bg-surface-2"}`}
                  >
                    <ConversationAvatar participants={others} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className={`min-w-0 flex-1 truncate text-sm ${unread ? "font-semibold text-ink" : "font-medium text-ink-2"}`}>{conversationName(c, me.id)}</span>
                        <span className={`shrink-0 text-xs ${unread ? "font-medium text-brand-700" : "text-faint"}`}>{timeLabel(c.lastMessageAt)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className={`min-w-0 flex-1 truncate text-xs ${unread ? "text-ink-2" : "text-muted"}`}>
                          {c.lastMessage ? (
                            <>
                              {c.lastMessage.mine ? "Vous : " : others.length > 1 ? `${c.lastMessage.authorName.split(" ")[0]} : ` : ""}
                              {c.lastMessage.deleted ? <em>Message supprimé</em> : c.lastMessage.excerpt}
                            </>
                          ) : (
                            <em>Aucun message</em>
                          )}
                        </span>
                        {unread && (
                          <span className="shrink-0 rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold leading-5 text-on-brand" aria-label={`${c.unreadCount} non lu${c.unreadCount > 1 ? "s" : ""}`}>
                            {c.unreadCount}
                          </span>
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* Fil */}
      <section className={`min-h-0 min-w-0 flex-1 flex-col ${conversationId ? "flex" : "hidden md:flex"}`}>
        {conversationId ? (
          <ConversationThread key={conversationId} me={me} conversationId={conversationId} onChanged={loadList} onLeft={() => void loadList().then(() => router.push("/messages"))} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-muted">
            <div>
              <MessagesSquare className="mx-auto h-10 w-10 text-faint" />
              <p className="mt-2 text-sm">Choisissez une conversation ou démarrez-en une nouvelle.</p>
            </div>
          </div>
        )}
      </section>

      {creating && (
        <NewConversationDialog
          me={me}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            void loadList();
            open(id);
          }}
        />
      )}
    </div>
  );
}

function ConversationAvatar({ participants }: { participants: { id: string; name: string; avatarUrl: string | null }[] }) {
  if (participants.length <= 1) {
    const p = participants[0];
    return p ? <Avatar id={p.id} name={p.name} src={p.avatarUrl} size={40} /> : <span className="h-10 w-10 shrink-0 rounded-full bg-surface-3" />;
  }
  return (
    <span className="relative h-10 w-10 shrink-0">
      <Avatar id={participants[0].id} name={participants[0].name} src={participants[0].avatarUrl} size={28} className="absolute left-0 top-0" />
      <Avatar id={participants[1].id} name={participants[1].name} src={participants[1].avatarUrl} size={28} className="absolute bottom-0 right-0 ring-2 ring-surface" />
    </span>
  );
}

// --- Fil d'une conversation --------------------------------------------------------------------

type ThreadState = { title: string; participants: ParticipantDto[]; messages: MessageDto[]; hasMore: boolean; serverTime: string };

function mergeMessages(current: MessageDto[], incoming: MessageDto[]): MessageDto[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  // Une citation reflète la suppression du message cité.
  const deleted = new Set(incoming.filter((m) => m.deleted).map((m) => m.id));
  const all = [...byId.values()].map((m) => (m.replyTo && deleted.has(m.replyTo.id) ? { ...m, replyTo: { ...m.replyTo, deleted: true, excerpt: "" } } : m));
  return all.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

function ConversationThread({ me, conversationId, onChanged, onLeft }: { me: MessagesUser; conversationId: string; onChanged: () => void; onLeft: () => void }) {
  const [state, setState] = useState<ThreadState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<MessageDto | null>(null);
  const [draft, setDraft] = useState("");
  const [composerKey, setComposerKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  /** Ma dernière lecture au moment de l'ouverture : place le séparateur « Nouveaux messages ». */
  const [unreadFrom, setUnreadFrom] = useState<string | null | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const sinceRef = useRef<string | null>(null);
  const stateRef = useRef<ThreadState | null>(null);
  stateRef.current = state;

  const markRead = useCallback(async () => {
    try {
      await api.post(`/messages/conversations/${conversationId}/read`, { read: true });
      setState((s) => (s ? { ...s, participants: s.participants.map((p) => (p.id === me.id ? { ...p, lastReadAt: new Date().toISOString() } : p)) } : s));
      void refreshUnreadMessages();
      onChanged();
    } catch {
      /* ignoré : réessayé au prochain rafraîchissement */
    }
  }, [conversationId, me.id, onChanged]);

  // Chargement initial
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ conversation: ConversationDto }>(`/messages/conversations/${conversationId}`)
      .then(({ conversation }) => {
        if (cancelled) return;
        sinceRef.current = conversation.serverTime;
        const mine = conversation.participants.find((p) => p.id === me.id);
        setUnreadFrom(mine?.lastReadAt ?? null);
        setState({ title: conversation.title, participants: conversation.participants, messages: conversation.messages, hasMore: conversation.hasMore, serverTime: conversation.serverTime });
        const hasUnread = conversation.messages.some((m) => m.authorId !== me.id && !m.deleted && (!mine?.lastReadAt || m.createdAt > mine.lastReadAt));
        if (hasUnread) void markRead();
      })
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [conversationId, me.id, markRead]);

  // Rafraîchissement : messages nouveaux ou supprimés depuis le dernier passage, et « vu » des autres.
  useEffect(() => {
    const tick = async () => {
      if (!sinceRef.current || document.visibilityState !== "visible") return;
      try {
        const { conversation } = await api.get<{ conversation: ConversationDto }>(`/messages/conversations/${conversationId}?since=${encodeURIComponent(sinceRef.current)}`);
        sinceRef.current = conversation.serverTime;
        const fresh = conversation.messages.filter((m) => m.authorId !== me.id && !m.deleted && !stateRef.current?.messages.some((x) => x.id === m.id));
        setState((s) => (s ? { ...s, title: conversation.title, participants: conversation.participants, messages: mergeMessages(s.messages, conversation.messages) } : s));
        if (fresh.length > 0 && document.hasFocus()) void markRead();
      } catch {
        /* réseau : on réessaiera */
      }
    };
    const t = setInterval(() => void tick(), 4_000);
    const onFocus = () => void tick();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [conversationId, me.id, markRead]);

  // Défilement : en bas à l'ouverture et à chaque nouveau message, sauf si l'on relit plus haut.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [state?.messages]);

  async function loadOlder() {
    if (!state || state.messages.length === 0) return;
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    setLoadingOlder(true);
    try {
      const { conversation } = await api.get<{ conversation: ConversationDto }>(`/messages/conversations/${conversationId}?before=${encodeURIComponent(state.messages[0].id)}`);
      stickToBottom.current = false;
      setState((s) => (s ? { ...s, messages: mergeMessages(s.messages, conversation.messages), hasMore: conversation.hasMore } : s));
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoadingOlder(false);
    }
  }

  async function send() {
    if (sending || isBlank(draft) || draft.includes('src="blob:')) return;
    setSending(true);
    setSendError(null);
    try {
      const { message } = await api.post<{ message: MessageDto }>(`/messages/conversations/${conversationId}/messages`, { body: draft, replyToId: replyTo?.id ?? null });
      stickToBottom.current = true;
      setState((s) => (s ? { ...s, messages: mergeMessages(s.messages, [message]), participants: s.participants.map((p) => (p.id === me.id ? { ...p, lastReadAt: message.createdAt } : p)) } : s));
      setUnreadFrom(undefined);
      setDraft("");
      setReplyTo(null);
      setComposerKey((k) => k + 1);
      onChanged();
    } catch (e) {
      setSendError(errorText(e));
    } finally {
      setSending(false);
    }
  }

  async function remove(m: MessageDto) {
    if (!confirm("Supprimer ce message pour tout le monde ?")) return;
    try {
      const { message } = await api.delete<{ message: MessageDto }>(`/messages/conversations/${conversationId}/messages/${m.id}`);
      setState((s) => (s ? { ...s, messages: mergeMessages(s.messages, [message]) } : s));
      if (replyTo?.id === m.id) setReplyTo(null);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function markUnread() {
    setMenu(false);
    try {
      const r = await api.post<{ lastReadAt: string | null }>(`/messages/conversations/${conversationId}/read`, { read: false });
      setState((s) => (s ? { ...s, participants: s.participants.map((p) => (p.id === me.id ? { ...p, lastReadAt: r.lastReadAt } : p)) } : s));
      setUnreadFrom(r.lastReadAt);
      void refreshUnreadMessages();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function leave() {
    setMenu(false);
    if (!confirm("Quitter cette conversation ? Elle disparaîtra de votre liste.")) return;
    try {
      await api.delete(`/messages/conversations/${conversationId}`);
      void refreshUnreadMessages();
      onLeft();
    } catch (e) {
      setError(errorText(e));
    }
  }

  function jumpTo(id: string) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const bubble = el.querySelector<HTMLElement>("[data-bubble]");
    if (bubble) {
      bubble.classList.remove("message-flash");
      void bubble.offsetWidth;
      bubble.classList.add("message-flash");
    }
  }

  // Fermeture du menu au clic extérieur / Échap.
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenu(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  if (error && !state) {
    return (
      <div className="p-6">
        <Link href="/messages" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink md:hidden">
          <ArrowLeft className="h-4 w-4" /> Conversations
        </Link>
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>
      </div>
    );
  }
  if (!state) return <p className="p-6 text-sm text-muted">Chargement…</p>;

  const others = state.participants.filter((p) => p.id !== me.id);
  const name = conversationName(state, me.id);
  const lastMine = [...state.messages].reverse().find((m) => m.authorId === me.id && !m.deleted);

  return (
    <>
      <header className="flex items-center gap-3 border-b border-line px-3 py-2.5 sm:px-4">
        <Link href="/messages" className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink md:hidden" aria-label="Retour aux conversations">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <ConversationAvatar participants={others} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{name}</h2>
          <p className="truncate text-xs text-muted">{state.participants.length > 2 ? `${state.participants.length} participants : ${state.participants.map((p) => (p.id === me.id ? "vous" : p.name)).join(", ")}` : "Conversation privée"}</p>
        </div>
        <div ref={menuRef} className="relative">
          <button type="button" onClick={() => setMenu((v) => !v)} aria-label="Actions de la conversation" aria-expanded={menu} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink">
            <MoreHorizontal className="h-5 w-5" />
          </button>
          {menu && (
            <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lg">
              <button role="menuitem" type="button" onClick={markUnread} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2">
                <EyeOff className="h-4 w-4 text-muted" /> Marquer comme non lu
              </button>
              <button role="menuitem" type="button" onClick={leave} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger hover:bg-red-50">
                <LogOut className="h-4 w-4" /> Quitter la conversation
              </button>
            </div>
          )}
        </div>
      </header>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6"
        aria-live="polite"
      >
        {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}
        {state.hasMore && (
          <div className="mb-4 text-center">
            <Button variant="outline" onClick={loadOlder} disabled={loadingOlder}>
              {loadingOlder ? "Chargement…" : "Messages précédents"}
            </Button>
          </div>
        )}
        {state.messages.length === 0 && <p className="py-10 text-center text-sm text-muted">Aucun message pour l&apos;instant. Écrivez le premier !</p>}
        {state.messages.map((m, i) => {
          const prev = state.messages[i - 1];
          const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          const grouped = !newDay && prev && prev.authorId === m.authorId && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000 && !m.replyTo;
          const firstUnread =
            unreadFrom !== undefined &&
            m.authorId !== me.id &&
            (unreadFrom === null || m.createdAt > unreadFrom) &&
            !state.messages.slice(0, i).some((x) => x.authorId !== me.id && (unreadFrom === null || x.createdAt > unreadFrom));
          return (
            <div key={m.id}>
              {newDay && (
                <div className="my-4 flex items-center gap-3 text-xs font-medium text-faint">
                  <span className="h-px flex-1 bg-line" />
                  {dayLabel(m.createdAt)}
                  <span className="h-px flex-1 bg-line" />
                </div>
              )}
              {firstUnread && (
                <div className="my-3 flex items-center gap-3 text-xs font-semibold text-brand-700">
                  <span className="h-px flex-1 bg-brand-500" />
                  Nouveaux messages
                  <span className="h-px flex-1 bg-brand-500" />
                </div>
              )}
              <MessageRow
                m={m}
                me={me}
                grouped={!!grouped}
                showAuthor={others.length > 1}
                participants={state.participants}
                isLastMine={m.id === lastMine?.id}
                onReply={() => setReplyTo(m)}
                onDelete={() => void remove(m)}
                onJump={jumpTo}
              />
            </div>
          );
        })}
      </div>

      <div className="border-t border-line bg-surface p-2 sm:p-3">
        {replyTo && (
          <div className="mb-2 flex items-start gap-2 rounded-lg border-l-4 border-brand-500 bg-brand-50 px-3 py-1.5 text-sm">
            <CornerUpLeft className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-brand-700">Réponse à {replyTo.authorId === me.id ? "vous-même" : replyTo.authorName}</div>
              <div className="truncate text-ink-2">{replyTo.deleted ? <em>Message supprimé</em> : excerptOf(replyTo.body)}</div>
            </div>
            <button type="button" onClick={() => setReplyTo(null)} aria-label="Annuler la réponse" className="rounded p-1 text-muted hover:bg-surface hover:text-ink">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {sendError && <p className="mb-2 rounded-lg bg-red-50 px-3 py-1.5 text-sm text-danger">{sendError}</p>}
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <RichTextEditor
              variant="compact"
              initialHtml=""
              documentKey={`composer-${composerKey}`}
              onChange={setDraft}
              onSubmit={() => void send()}
              minHeight={44}
              autoFocus
              placeholder={`Écrire à ${name}… (Ctrl + Entrée pour envoyer)`}
            />
          </div>
          <Button onClick={() => void send()} disabled={sending || isBlank(draft)} className="h-11 !px-3" title="Envoyer (Ctrl + Entrée)" aria-label="Envoyer">
            <Send className="h-4 w-4" /> <span className="hidden sm:inline">Envoyer</span>
          </Button>
        </div>
      </div>
    </>
  );
}

function excerptOf(html: string): string {
  if (typeof document === "undefined") return "";
  // DOMParser : document inerte (ni script, ni chargement d'image) ; seul le texte est lu.
  const text = (new DOMParser().parseFromString(html, "text/html").body.textContent ?? "").replace(/\s+/g, " ").trim();
  return text ? (text.length > 140 ? text.slice(0, 139) + "…" : text) : "(image)";
}

function MessageRow({
  m,
  me,
  grouped,
  showAuthor,
  participants,
  isLastMine,
  onReply,
  onDelete,
  onJump,
}: {
  m: MessageDto;
  me: MessagesUser;
  grouped: boolean;
  showAuthor: boolean;
  participants: ParticipantDto[];
  isLastMine: boolean;
  onReply: () => void;
  onDelete: () => void;
  onJump: (id: string) => void;
}) {
  const mine = m.authorId === me.id;
  const others = participants.filter((p) => p.id !== me.id);
  const seenBy = mine ? others.filter((p) => p.lastReadAt && p.lastReadAt >= m.createdAt) : [];
  const seenAll = mine && others.length > 0 && seenBy.length === others.length;
  const time = new Date(m.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div id={`msg-${m.id}`} className={`group flex gap-2 ${mine ? "flex-row-reverse" : ""} ${grouped ? "mt-0.5" : "mt-3"}`}>
      <div className="w-8 shrink-0">{!mine && !grouped && <Avatar id={m.authorId ?? m.id} name={m.authorName} src={m.authorAvatarUrl} size={32} />}</div>
      <div className={`flex min-w-0 max-w-[85%] flex-col sm:max-w-[70%] ${mine ? "items-end" : "items-start"}`}>
        {!grouped && !mine && showAuthor && <span className="mb-0.5 px-1 text-xs font-medium text-muted">{m.authorName}</span>}
        <div className={`flex items-center gap-1 ${mine ? "flex-row-reverse" : ""}`}>
          <div
            data-bubble
            className={`min-w-0 rounded-2xl px-3 py-2 text-sm ${m.deleted ? "border border-dashed border-line-strong bg-transparent text-muted" : mine ? "bg-brand-50 text-ink" : "bg-surface-2 text-ink"}`}
          >
            {m.replyTo && (
              <button
                type="button"
                onClick={() => onJump(m.replyTo!.id)}
                className="mb-1.5 block w-full rounded-lg border-l-4 border-brand-500 bg-surface/70 px-2 py-1 text-left text-xs hover:bg-surface"
                title="Voir le message cité"
              >
                <span className="flex items-center gap-1 font-semibold text-brand-700">
                  <CornerUpLeft className="h-3 w-3" /> {m.replyTo.authorName}
                </span>
                <span className="block truncate text-ink-2">{m.replyTo.deleted ? <em>Message supprimé</em> : m.replyTo.excerpt}</span>
              </button>
            )}
            {m.deleted ? (
              <em className="flex items-center gap-1.5">
                <Trash2 className="h-3.5 w-3.5" /> Message supprimé
              </em>
            ) : (
              // Contenu assaini par sanitizeNotes() côté serveur (lib/messages.ts, toMessageDto).
              <div className="message-body prose prose-sm max-w-none break-words" dangerouslySetInnerHTML={{ __html: m.body }} />
            )}
          </div>
          {!m.deleted && (
            <div className="flex shrink-0 gap-0.5 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
              <button type="button" onClick={onReply} aria-label="Répondre à ce message" title="Répondre" className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink">
                <CornerUpLeft className="h-4 w-4" />
              </button>
              {mine && (
                <button type="button" onClick={onDelete} aria-label="Supprimer ce message" title="Supprimer" className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-danger">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>
        <span className="mt-0.5 flex items-center gap-1 px-1 text-[11px] text-faint">
          {time}
          {mine && !m.deleted && (
            <span title={seenBy.length ? `Vu par ${seenBy.map((p) => p.name).join(", ")}` : "Envoyé, pas encore vu"} className={`inline-flex items-center gap-0.5 ${seenAll ? "text-brand-700" : ""}`}>
              {seenBy.length ? <CheckCheck className="h-3.5 w-3.5" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
              {isLastMine && <span>{seenAll ? (others.length > 1 ? "Vu par tous" : "Vu") : seenBy.length ? `Vu par ${seenBy.map((p) => p.name.split(" ")[0]).join(", ")}` : "Non vu"}</span>}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

// --- Nouvelle conversation -----------------------------------------------------------------------

function NewConversationDialog({ me, onClose, onCreated }: { me: MessagesUser; onClose: () => void; onCreated: (id: string) => void }) {
  const [contacts, setContacts] = useState<ContactDto[] | null>(null);
  const [selected, setSelected] = useState<ContactDto[]>([]);
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ contacts: ContactDto[] }>("/messages/contacts")
      .then((r) => setContacts(r.contacts))
      .catch((e) => setError(errorText(e)));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const filtered = (contacts ?? []).filter((c) => !q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q));
  const toggle = (c: ContactDto) => setSelected((s) => (s.some((x) => x.id === c.id) ? s.filter((x) => x.id !== c.id) : [...s, c]));

  async function lookup() {
    setLookupMsg(null);
    try {
      const { user } = await api.get<{ user: { id: string; name: string; email: string } | null }>(`/users/lookup?email=${encodeURIComponent(query.trim())}`);
      if (!user || user.id === me.id) return setLookupMsg("Aucun compte avec cette adresse.");
      const c = { ...user, avatarUrl: null };
      setContacts((list) => (list && !list.some((x) => x.id === c.id) ? [c, ...list] : list));
      setSelected((s) => (s.some((x) => x.id === c.id) ? s : [...s, c]));
      setQuery("");
    } catch (e) {
      setLookupMsg(errorText(e));
    }
  }

  async function create() {
    if (busy || selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ conversationId: string }>("/messages/conversations", {
        participantIds: selected.map((c) => c.id),
        title: selected.length > 1 ? title.trim() : undefined,
        body: isBlank(body) ? undefined : body,
      });
      void refreshUnreadMessages();
      onCreated(r.conversationId);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  const looksLikeEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(query.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="new-conv-title" className="flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 id="new-conv-title" className="flex-1 text-lg font-semibold">
            Nouvelle conversation
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
          <label className="block text-sm font-medium" htmlFor="new-conv-search">
            Destinataires
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="new-conv-search"
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
          <ul className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-line">
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
          {selected.length > 1 && (
            <label className="mt-3 block text-sm font-medium">
              Titre de la conversation <span className="font-normal text-muted">(facultatif)</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Ex. Lancement du projet" className={`${inputClass} mt-1 w-full`} />
            </label>
          )}
          <div className="mt-3">
            <span className="text-sm font-medium">Premier message</span>
            <div className="mt-1">
              <RichTextEditor variant="compact" initialHtml="" onChange={setBody} onSubmit={() => void create()} minHeight={70} placeholder="Votre message… (facultatif)" />
            </div>
          </div>
          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={() => void create()} disabled={busy || selected.length === 0}>
            {busy ? "Création…" : "Démarrer la conversation"}
          </Button>
        </div>
      </div>
    </div>
  );
}
