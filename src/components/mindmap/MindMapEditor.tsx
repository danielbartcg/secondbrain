"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, CheckCircle2, ChevronsDownUp, ChevronsUpDown, Circle, CornerDownRight, Eye, EyeOff, Focus, GitBranchPlus, LayoutTemplate, ListTodo, Lock, PanelRightOpen, Plus, Share2, Trash2, Users, X } from "lucide-react";
import type { NodeStatus } from "@prisma/client";
import { api } from "@/lib/client";
import type { MindMapDto, MindNodeDto } from "@/lib/mindmaps";
import { layoutMindMap, subtreeIds, type Side } from "@/lib/mindmap-layout";
import { RichTextEditor } from "@/components/RichTextEditor";
import { Button, InlineEdit, NODE_STATUS_LABEL, errorMessage, toast } from "@/components/ui";
import { NodeTasksPanel } from "./NodeTasksPanel";
import { useSearchParams } from "next/navigation";
import { PinButton } from "@/components/PinButton";
import { ShareMapDialog } from "./ShareMapDialog";

/**
 * Éditeur de carte mentale.
 *
 *  - Mise en page automatique (src/lib/mindmap-layout.ts), pan/zoom React Flow.
 *  - Clavier : Tab = enfant, Entrée = frère, Suppr = supprimer, F2 / double-clic
 *    = renommer, Échap = désélectionner, Espace = replier/déplier.
 *  - Glisser un nœud **sur** un autre le rattache à ce nœud ; le déposer
 *    ailleurs mémorise sa position (sa descendance suit). « Affichage
 *    optimisé » efface ces positions après confirmation.
 *  - Panneau latéral (tiroir bas sur mobile) : titre, couleur, statut, notes riches.
 *  - Statut : « à surveiller » = halo ambré ; « fermé » = hachuré, et masqué
 *    (avec sa descendance) tant que « Afficher les nœuds fermés » est inactif.
 *  - Mises à jour **optimistes** : un nouveau nœud apparaît (et s'édite)
 *    immédiatement sous un identifiant temporaire, remplacé à la réponse du
 *    serveur. Les requêtes partent une par une (file d'attente) ; les appels
 *    résolvent l'identifiant réel au moment où ils partent. En cas d'erreur,
 *    la carte est rechargée.
 *  - Partage (`map.access`) : le propriétaire partage la carte (bouton
 *    « Partager ») ; en écriture, tout fonctionne sauf la gestion des
 *    partages ; en **lecture seule**, aucune modification n'est possible
 *    (création, renommage, glisser, statut, couleur, notes, tâches) — replier
 *    / déplier reste possible mais n'est pas enregistré.
 */

const COLORS = ["#4f5ff0", "#1f9d55", "#d98a0b", "#d13b3b", "#8b5cf6", "#0ea5e9", "#ec4899", "#64748b"];
/** Couleur de rendu des liens sans couleur (jeton du thème, jamais enregistrée). */
const DEFAULT_EDGE = "var(--color-line-strong)";
const NEW_TITLE = "Nouvelle idée";

type MindData = {
  title: string;
  color: string | null;
  isRoot: boolean;
  side: Side;
  hiddenCount: number;
  collapsed: boolean;
  hasNotes: boolean;
  status: NodeStatus;
  /** Tâches rattachées non clôturées (indicateur visuel). */
  openTaskCount: number;
  /** Nœuds fermés (et leur descendance) masqués sous ce nœud. */
  closedHidden: number;
  editing: boolean;
  onRename: (id: string, title: string) => void;
  onStopEditing: () => void;
  onToggleCollapse: (id: string) => void;
  onShowClosed: () => void;
};
type MindNode = Node<MindData, "mind">;

const MindNodeView = memo(function MindNodeView({ id, data, selected }: NodeProps<MindNode>) {
  const [draft, setDraft] = useState(data.title);
  const committed = useRef(false);
  useEffect(() => {
    if (data.editing) {
      setDraft(data.title);
      committed.current = false;
    }
  }, [data.editing, data.title]);

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    const t = draft.trim();
    if (t && t !== data.title) data.onRename(id, t);
    data.onStopEditing();
  };

  const watch = data.status === "WATCH";
  const closed = data.status === "CLOSED";
  const border = watch ? "var(--color-warn)" : (data.color ?? (data.isRoot ? "var(--color-brand-600)" : "var(--color-line-strong)"));
  const background = watch ? "var(--color-amber-50)" : data.isRoot && !data.color ? "var(--color-brand-50)" : undefined;
  return (
    <div
      className={`mind-node ${selected ? "is-selected" : ""} ${data.isRoot ? "is-root" : ""} ${watch ? "is-watch" : ""} ${closed ? "is-closed" : ""}`}
      style={{ borderColor: border, backgroundColor: background }}
      title={closed ? "Fermé" : watch ? "À surveiller" : undefined}
    >
      <Handle type="target" position={Position.Left} id="tl" />
      <Handle type="target" position={Position.Right} id="tr" />
      <Handle type="source" position={Position.Left} id="sl" />
      <Handle type="source" position={Position.Right} id="sr" />
      {data.editing ? (
        <input
          ref={(el) => {
            if (el && document.activeElement !== el) {
              el.focus();
              el.select();
            }
          }}
          className="nodrag nowheel nopan"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              commit();
              // Entrée / Tab après la saisie : enchaîner immédiatement (frère / enfant).
              if (e.key === "Tab") window.dispatchEvent(new CustomEvent("mindmap:add-child"));
              else window.dispatchEvent(new CustomEvent("mindmap:add-sibling"));
            }
            if (e.key === "Escape") {
              committed.current = true;
              data.onStopEditing();
            }
          }}
        />
      ) : (
        <div className="flex items-center gap-1.5">
          {watch && <Eye className="h-3.5 w-3.5 shrink-0 text-warn" />}
          <span className="mind-title truncate" title={data.title}>
            {data.title}
          </span>
          {data.hasNotes && <span className="text-[10px] text-muted" title="Contient des notes">📝</span>}
          {data.openTaskCount > 0 && (
            <span className="mind-tasks" title={data.openTaskCount > 1 ? `${data.openTaskCount} tâches ouvertes rattachées` : "1 tâche ouverte rattachée"}>
              <ListTodo className="h-3 w-3" /> {data.openTaskCount}
            </span>
          )}
          {data.closedHidden > 0 && (
            <button
              type="button"
              className="nodrag rounded-full bg-surface-3 px-1.5 text-[10px] text-muted hover:bg-surface-2"
              title={`${data.closedHidden > 1 ? `${data.closedHidden} nœuds fermés masqués` : "1 nœud fermé masqué"} — cliquer pour les afficher`}
              onClick={(e) => {
                e.stopPropagation();
                data.onShowClosed();
              }}
            >
              ✓{data.closedHidden}
            </button>
          )}
          {data.hiddenCount > 0 && (
            <button
              type="button"
              className="nodrag ml-auto rounded-full bg-surface-3 px-1.5 text-[11px] font-medium text-ink-2 hover:bg-brand-100"
              title="Déplier"
              onClick={(e) => {
                e.stopPropagation();
                data.onToggleCollapse(id);
              }}
            >
              +{data.hiddenCount}
            </button>
          )}
        </div>
      )}
    </div>
  );
});

const nodeTypes: NodeTypes = { mind: MindNodeView };

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

let tempCounter = 0;

export function MindMapEditor({ initial }: { initial: MindMapDto }) {
  return (
    <ReactFlowProvider>
      <Editor initial={initial} />
    </ReactFlowProvider>
  );
}

function Editor({ initial }: { initial: MindMapDto }) {
  const [map, setMap] = useState(initial);
  const [nodes, setNodes] = useState<MindNodeDto[]>(initial.nodes);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [sharing, setSharing] = useState(false);
  const searchParams = useSearchParams();
  /** Carte partagée en lecture seule : toute écriture est désactivée. */
  const readOnly = map.access === "read";
  const isOwner = map.access === "owner";
  const closeSharing = useCallback(() => setSharing(false), []);

  // Arrivée depuis la recherche (?node=…) : sélectionne et ouvre le nœud (fermés affichés si besoin).
  const initialNode = useRef(searchParams.get("node"));
  useEffect(() => {
    const id = initialNode.current;
    if (!id || !initial.nodes.some((n) => n.id === id)) return;
    setShowClosed(true);
    setSelectedId(id);
    setPanelOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [saving, setSaving] = useState(0);
  const [layoutTick, setLayoutTick] = useState(0);
  const { fitView, setCenter, getZoom } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const notesTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;

  // Nœuds fermés : masqués (avec leur descendance) sauf si demandé. On compte,
  // par nœud visible, ce qui est masqué dessous pour l'indiquer.
  const { visibleNodes, closedHidden, closedCount } = useMemo(() => {
    const closedCount = nodes.filter((n) => n.status === "CLOSED" && n.parentId !== null).length;
    if (showClosed) return { visibleNodes: nodes, closedHidden: new Map<string, number>(), closedCount };
    const children = new Map<string, MindNodeDto[]>();
    for (const n of nodes) if (n.parentId) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n]);
    const hidden = new Set<string>();
    const closedHidden = new Map<string, number>();
    const sizeOf = (id: string): number => 1 + (children.get(id) ?? []).reduce((a, c) => a + sizeOf(c.id), 0);
    const walk = (id: string) => {
      for (const c of children.get(id) ?? []) {
        if (c.status === "CLOSED") {
          closedHidden.set(id, (closedHidden.get(id) ?? 0) + sizeOf(c.id));
          const stack = [c.id];
          while (stack.length) {
            const cur = stack.pop()!;
            hidden.add(cur);
            stack.push(...(children.get(cur) ?? []).map((x) => x.id));
          }
        } else walk(c.id);
      }
    };
    walk(map.rootId);
    return { visibleNodes: nodes.filter((n) => !hidden.has(n.id)), closedHidden, closedCount };
  }, [nodes, showClosed, map.rootId]);

  // --- Réseau ----------------------------------------------------------------
  /** Identifiant temporaire → identifiant réel, résolu au moment où la requête part. */
  const idMap = useRef(new Map<string, string>());
  const real = useCallback((id: string) => idMap.current.get(id) ?? id, []);

  const reload = useCallback(async () => {
    const { mindmap } = await api.get<{ mindmap: MindMapDto }>(`/mindmaps/${map.id}`);
    setMap(mindmap);
    setNodes(mindmap.nodes);
    setSelectedId(null);
    setEditingId(null);
  }, [map.id]);

  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const run = useCallback(
    <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      setSaving((s) => s + 1);
      const task = queue.current.then(fn).catch(async (e) => {
        console.error(e);
        toast(`Modification annulée : ${errorMessage(e)}`, "error");
        await reload().catch(() => {});
        return undefined;
      });
      queue.current = task.finally(() => setSaving((s) => s - 1));
      return task as Promise<T | undefined>;
    },
    [reload],
  );

  // --- Mutations ---------------------------------------------------------------
  const patchLocal = useCallback((id: string, patch: Partial<MindNodeDto>) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);

  const rename = useCallback(
    (id: string, title: string) => {
      if (readOnly) return;
      patchLocal(id, { title });
      if (id === map.rootId) setMap((m) => ({ ...m, title }));
      void run(() => api.patch(`/mindmaps/${map.id}/nodes/${real(id)}`, { title }));
    },
    [map.id, map.rootId, patchLocal, real, run, readOnly],
  );

  const setColor = useCallback(
    (id: string, color: string | null) => {
      if (readOnly) return;
      patchLocal(id, { color });
      void run(() => api.patch(`/mindmaps/${map.id}/nodes/${real(id)}`, { color }));
    },
    [map.id, patchLocal, real, run, readOnly],
  );

  const toggleCollapse = useCallback(
    (id: string) => {
      const n = byId.get(id);
      if (!n) return;
      const collapsed = !n.collapsed;
      patchLocal(id, { collapsed });
      // Lecture seule : repli local, non enregistré.
      if (!readOnly) void run(() => api.patch(`/mindmaps/${map.id}/nodes/${real(id)}`, { collapsed }));
    },
    [byId, map.id, patchLocal, real, run, readOnly],
  );

  const setStatus = useCallback(
    (id: string, status: NodeStatus) => {
      const n = byId.get(id);
      if (readOnly || !n || n.status === status) return;
      patchLocal(id, { status });
      // Un nœud fermé disparaît (sauf affichage des fermés) : on sélectionne son parent.
      if (status === "CLOSED" && !showClosed && n.parentId) setSelectedId(n.parentId);
      void run(() => api.patch(`/mindmaps/${map.id}/nodes/${real(id)}`, { status }));
    },
    [byId, map.id, patchLocal, real, run, showClosed, readOnly],
  );

  /** Position manuelle mémorisée (null = reprend la mise en page automatique). */
  const setPosition = useCallback(
    (id: string, x: number | null, y: number | null) => {
      if (readOnly) return;
      patchLocal(id, { x, y });
      void run(() => api.patch(`/mindmaps/${map.id}/nodes/${real(id)}`, { x, y }));
    },
    [map.id, patchLocal, real, run, readOnly],
  );

  /** « Affichage optimisé » : efface toutes les positions manuelles de la carte. */
  const resetLayout = useCallback(() => {
    if (readOnly) return;
    if (!confirm("Êtes-vous sûr(e) de vouloir écraser vos personnalisations liées à la position des éléments sur le schéma ?")) return;
    setNodes((ns) => ns.map((n) => ({ ...n, x: null, y: null })));
    void run(async () => {
      const { mindmap } = await api.delete<{ mindmap: MindMapDto }>(`/mindmaps/${map.id}/layout`);
      setNodes(mindmap.nodes);
      requestAnimationFrame(() => void fitView({ padding: 0.25, duration: 400, maxZoom: 1.25 }));
    });
  }, [map.id, run, fitView, readOnly]);

  const setNotes = useCallback(
    (id: string, notes: string) => {
      if (readOnly) return;
      patchLocal(id, { notes });
      const timers = notesTimers.current;
      clearTimeout(timers.get(id));
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          void run(() => api.patch(`/mindmaps/${map.id}/nodes/${real(id)}`, { notes }));
        }, 600),
      );
    },
    [map.id, patchLocal, real, run, readOnly],
  );

  /** Création optimiste : le nœud apparaît et passe en édition immédiatement. */
  const addChild = useCallback(
    (parentId: string, index?: number) => {
      if (readOnly) return;
      const tempId = `tmp-${Date.now()}-${tempCounter++}`;
      setNodes((ns) => {
        const next = ns.map((n) => (n.id === parentId ? { ...n, collapsed: false } : n));
        const siblings = next.filter((n) => n.parentId === parentId).sort((a, b) => a.order - b.order);
        const at = index === undefined ? siblings.length : Math.min(index, siblings.length);
        const created: MindNodeDto = {
          id: tempId,
          parentId,
          title: NEW_TITLE,
          notes: "",
          color: null,
          collapsed: false,
          status: "OPEN",
          order: at,
          x: null,
          y: null,
          taskCount: 0,
          openTaskCount: 0,
          updatedAt: new Date().toISOString(),
        };
        siblings.splice(at, 0, created);
        const orders = new Map(siblings.map((s, i) => [s.id, i]));
        return [...next.map((n) => (orders.has(n.id) ? { ...n, order: orders.get(n.id)! } : n)), { ...created, order: at }];
      });
      setSelectedId(tempId);
      setEditingId(tempId);
      void run(async () => {
        const { node } = await api.post<{ node: MindNodeDto }>(`/mindmaps/${map.id}/nodes`, {
          parentId: real(parentId),
          title: NEW_TITLE,
          index,
        });
        idMap.current.set(tempId, node.id);
        setNodes((ns) =>
          ns.map((n) => (n.id === tempId ? { ...n, id: node.id } : n.parentId === tempId ? { ...n, parentId: node.id } : n)),
        );
        setSelectedId((s) => (s === tempId ? node.id : s));
        setEditingId((s) => (s === tempId ? node.id : s));
      });
    },
    [map.id, real, run, readOnly],
  );

  const addSibling = useCallback(
    (id: string) => {
      const n = byId.get(id);
      if (!n) return;
      if (!n.parentId) return addChild(id);
      return addChild(n.parentId, n.order + 1);
    },
    [addChild, byId],
  );

  const remove = useCallback(
    (id: string) => {
      const n = byId.get(id);
      if (readOnly || !n || !n.parentId) return;
      const ids = subtreeIds(nodes, id);
      if (ids.size > 1) {
        const sub = ids.size - 1;
        if (!confirm(`Supprimer « ${n.title} » et ${sub > 1 ? `ses ${sub} sous-nœuds` : "son sous-nœud"} ?`)) return;
      } else {
        const hasNotes = n.notes.replace(/<[^>]+>/g, "").trim().length > 0 || n.notes.includes("<img");
        const what = [hasNotes && "des notes", n.taskCount > 0 && (n.taskCount > 1 ? `${n.taskCount} tâches rattachées` : "une tâche rattachée")].filter(Boolean).join(" et ");
        if (what && !confirm(`Supprimer « ${n.title} » ? Ce nœud contient ${what}.`)) return;
      }
      setNodes((ns) => ns.filter((x) => !ids.has(x.id)));
      setSelectedId(n.parentId);
      setEditingId(null);
      void run(() => api.delete(`/mindmaps/${map.id}/nodes/${real(id)}`));
    },
    [byId, map.id, nodes, real, run, readOnly],
  );

  const move = useCallback(
    (id: string, parentId: string) => {
      const n = byId.get(id);
      if (readOnly || !n || n.parentId === parentId) return;
      const count = nodes.filter((x) => x.parentId === parentId).length;
      setNodes((ns) => ns.map((x) => (x.id === id ? { ...x, parentId, order: count } : x.id === parentId ? { ...x, collapsed: false } : x)));
      void run(() => api.post(`/mindmaps/${map.id}/nodes/${real(id)}/move`, { parentId: real(parentId) }));
    },
    [byId, map.id, nodes, real, run, readOnly],
  );

  const renameMap = useCallback(
    (title: string) => {
      if (readOnly) return;
      setMap((m) => ({ ...m, title }));
      patchLocal(map.rootId, { title });
      void run(() => api.patch(`/mindmaps/${map.id}`, { title }));
    },
    [map.id, map.rootId, patchLocal, run, readOnly],
  );

  const expandAll = useCallback(
    (collapsed: boolean) => {
      const targets = nodes.filter(
        (n) => n.collapsed !== collapsed && nodes.some((c) => c.parentId === n.id) && (collapsed ? n.parentId !== null : true),
      );
      if (targets.length === 0) return;
      setNodes((ns) => ns.map((n) => (targets.some((t) => t.id === n.id) ? { ...n, collapsed } : n)));
      if (!readOnly) void run(() => Promise.all(targets.map((t) => api.patch(`/mindmaps/${map.id}/nodes/${real(t.id)}`, { collapsed }))));
    },
    [map.id, nodes, real, run, readOnly],
  );

  // --- Sélection / clavier -----------------------------------------------------
  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setEditingId(null);
    if (id && typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches) setPanelOpen(true);
  }, []);

  const stopEditing = useCallback(() => {
    setEditingId(null);
    requestAnimationFrame(() => wrapperRef.current?.focus({ preventScroll: true }));
  }, []);

  // Raccourcis au niveau de la fenêtre : ils fonctionnent où que soit le focus,
  // sauf dans un champ de saisie (panneau, éditeur de notes, titre inline).
  const latest = useRef({ selectedId, editingId, addChild, addSibling, remove, toggleCollapse, select, readOnly });
  latest.current = { selectedId, editingId, addChild, addSibling, remove, toggleCollapse, select, readOnly };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { selectedId, editingId, addChild, addSibling, remove, toggleCollapse, select, readOnly } = latest.current;
      if (e.key === "Escape" && !isTypingTarget(e.target)) {
        select(null);
        setPanelOpen(false);
        return;
      }
      if (isTypingTarget(e.target) || editingId || !selectedId) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Lecture seule : seul Espace (replier / déplier, non enregistré) reste actif.
      if (readOnly && e.key !== " ") return;
      switch (e.key) {
        case "Tab":
          e.preventDefault();
          addChild(selectedId);
          break;
        case "Enter":
          e.preventDefault();
          addSibling(selectedId);
          break;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          remove(selectedId);
          break;
        case "F2":
          e.preventDefault();
          setEditingId(selectedId);
          break;
        case " ":
          e.preventDefault();
          toggleCollapse(selectedId);
          break;
      }
    };
    const onAddChild = () => {
      const { selectedId, addChild } = latest.current;
      if (selectedId) addChild(selectedId);
    };
    const onAddSibling = () => {
      const { selectedId, addSibling } = latest.current;
      if (selectedId) addSibling(selectedId);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mindmap:add-child", onAddChild);
    window.addEventListener("mindmap:add-sibling", onAddSibling);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mindmap:add-child", onAddChild);
      window.removeEventListener("mindmap:add-sibling", onAddSibling);
    };
  }, []);

  // --- Mise en page → React Flow ------------------------------------------------
  const { positions, edges: layoutEdges } = useMemo(() => layoutMindMap(visibleNodes, map.rootId), [visibleNodes, map.rootId]);
  const showClosedNodes = useCallback(() => setShowClosed(true), []);

  const [rfNodes, setRfNodes] = useState<MindNode[]>([]);
  useEffect(() => {
    setRfNodes(
      [...positions.values()].map((p) => {
        const n = byId.get(p.id)!;
        return {
          id: p.id,
          type: "mind",
          position: { x: p.x, y: p.y },
          width: p.width,
          height: p.height,
          draggable: !readOnly,
          selected: p.id === selectedId,
          data: {
            title: n.title,
            color: n.color,
            isRoot: p.side === "root",
            side: p.side,
            hiddenCount: p.hiddenCount,
            collapsed: n.collapsed,
            hasNotes: n.notes.replace(/<[^>]+>/g, "").trim().length > 0 || n.notes.includes("<img"),
            status: n.status,
            openTaskCount: n.openTaskCount,
            closedHidden: closedHidden.get(p.id) ?? 0,
            editing: editingId === p.id,
            onRename: rename,
            onStopEditing: stopEditing,
            onToggleCollapse: toggleCollapse,
            onShowClosed: showClosedNodes,
          },
        };
      }),
    );
  }, [positions, byId, closedHidden, selectedId, editingId, rename, stopEditing, toggleCollapse, showClosedNodes, layoutTick, readOnly]);

  // Le côté des connecteurs suit la position réelle (un nœud déplacé à gauche de
  // son parent se relie par la gauche).
  const rfEdges = useMemo<Edge[]>(
    () =>
      layoutEdges.map((e) => {
        const child = byId.get(e.target);
        const ps = positions.get(e.source);
        const pt = positions.get(e.target);
        const right = ps && pt ? pt.x + pt.width / 2 >= ps.x + ps.width / 2 : e.side === "right";
        return {
          id: `${e.source}->${e.target}`,
          source: e.source,
          target: e.target,
          sourceHandle: right ? "sr" : "sl",
          targetHandle: right ? "tl" : "tr",
          type: "default",
          style: { stroke: child?.color ?? DEFAULT_EDGE, strokeWidth: 2 },
        };
      }),
    [layoutEdges, byId, positions],
  );

  const onNodesChange = useCallback((changes: NodeChange<MindNode>[]) => {
    setRfNodes((ns) => applyNodeChanges(changes, ns));
  }, []);

  const onNodeDragStop = useCallback(
    (_e: unknown, dragged: MindNode) => {
      if (readOnly) return;
      const forbidden = subtreeIds(nodes, dragged.id);
      const cx = dragged.position.x + (dragged.width ?? 0) / 2;
      const cy = dragged.position.y + (dragged.height ?? 0) / 2;
      // Déposé SUR un autre nœud (centre dans son cadre) : rattachement.
      let best: { id: string; d: number } | null = null;
      for (const other of rfNodes) {
        if (forbidden.has(other.id)) continue;
        const ox = other.position.x + (other.width ?? 0) / 2;
        const oy = other.position.y + (other.height ?? 0) / 2;
        const inside =
          cx >= other.position.x - 8 &&
          cx <= other.position.x + (other.width ?? 0) + 8 &&
          cy >= other.position.y - 8 &&
          cy <= other.position.y + (other.height ?? 0) + 8;
        const d = Math.hypot(cx - ox, cy - oy);
        if (inside && (!best || d < best.d)) best = { id: other.id, d };
      }
      if (best && dragged.id !== map.rootId) {
        move(dragged.id, best.id);
        setLayoutTick((t) => t + 1);
        return;
      }
      // Sinon : position libre mémorisée (si le nœud a vraiment bougé).
      const before = positions.get(dragged.id);
      if (before && Math.hypot(dragged.position.x - before.x, dragged.position.y - before.y) < 2) {
        setLayoutTick((t) => t + 1);
        return;
      }
      setPosition(dragged.id, Math.round(dragged.position.x), Math.round(dragged.position.y));
    },
    [move, nodes, rfNodes, positions, setPosition, map.rootId, readOnly],
  );
  const manualCount = useMemo(() => nodes.filter((n) => n.x !== null && n.y !== null).length, [nodes]);

  // Premier cadrage : une fois les nœuds mesurés par React Flow.
  const nodesInitialized = useNodesInitialized();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !nodesInitialized || rfNodes.length === 0) return;
    fitted.current = true;
    void fitView({ padding: 0.25, duration: 300, maxZoom: 1.25 });
  }, [nodesInitialized, rfNodes.length, fitView]);

  // Nœud ciblé par la recherche : centrage une fois la mise en page connue.
  const centeredOnTarget = useRef(false);
  useEffect(() => {
    const id = initialNode.current;
    if (!id || centeredOnTarget.current || !nodesInitialized) return;
    const p = positions.get(id);
    if (!p) return;
    centeredOnTarget.current = true;
    fitted.current = true;
    void setCenter(p.x + p.width / 2, p.y + p.height / 2, { zoom: 1.1, duration: 400 });
  }, [nodesInitialized, positions, setCenter]);

  // Recentre sur un nouveau nœud créé hors champ.
  useEffect(() => {
    if (!editingId) return;
    const p = positions.get(editingId);
    if (p) setCenter(p.x + p.width / 2, p.y + p.height / 2, { zoom: getZoom(), duration: 200 });
  }, [editingId, positions, setCenter, getZoom]);

  // --- Rendu -------------------------------------------------------------------
  const showPanel = Boolean(selected) && panelOpen;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col md:h-dvh">
      {/* En-tête */}
      <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <Link href="/mindmaps" className="shrink-0 rounded-lg p-1.5 text-ink-2 hover:bg-surface-2" title="Retour aux cartes" aria-label="Retour aux cartes">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        {readOnly ? (
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold sm:text-lg" title={map.title}>
            {map.title}
          </h1>
        ) : (
          <InlineEdit value={map.title} onSave={renameMap} as="h1" className="min-w-0 flex-1 truncate text-base font-semibold sm:text-lg" />
        )}
        <PinButton kind="MINDMAP" item={{ id: map.id, name: map.title }} className="shrink-0" />
        {isOwner && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSharing(true)}
            title={map.sharedWith ? `Partagée avec ${map.sharedWith} personne${map.sharedWith > 1 ? "s" : ""}` : "Partager la carte"}
            className="shrink-0"
          >
            <Share2 className="h-4 w-4" />
            <span className="hidden sm:inline">Partager</span>
            {map.sharedWith > 0 && <span className="rounded-full bg-brand-50 px-1.5 text-[11px] text-brand-700">{map.sharedWith}</span>}
          </Button>
        )}
        {!readOnly && <span className="hidden text-xs text-faint lg:block">Tab : enfant · Entrée : frère · Suppr · F2 : renommer · Espace : replier</span>}
        <span className={`shrink-0 text-xs ${saving ? "text-warn" : "text-faint"}`} role="status" title={saving ? "Enregistrement…" : "Enregistré"}>
          <span aria-hidden className={`inline-block h-2 w-2 rounded-full sm:hidden ${saving ? "bg-warn" : "bg-ok"}`} />
          <span className="sr-only sm:not-sr-only">{saving ? "Enregistrement…" : "Enregistré"}</span>
        </span>
        <Button variant="ghost" size="sm" onClick={() => expandAll(false)} title="Tout déplier">
          <ChevronsUpDown className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => expandAll(true)} title="Tout replier (niveau 1)">
          <ChevronsDownUp className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowClosed((v) => !v)}
          title={showClosed ? "Masquer les nœuds fermés" : `Afficher les nœuds fermés (${closedCount})`}
          className={showClosed ? "text-brand-700" : ""}
        >
          {showClosed ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          {closedCount > 0 && <span className="text-xs">{closedCount}</span>}
        </Button>
        {!readOnly && (
        <Button
          variant="ghost"
          size="sm"
          onClick={resetLayout}
          disabled={manualCount === 0}
          title={manualCount ? `Affichage optimisé : replacer automatiquement ${manualCount > 1 ? `les ${manualCount} nœuds déplacés` : "le nœud déplacé"}` : "Affichage optimisé (aucun nœud déplacé)"}
        >
          <LayoutTemplate className="h-4 w-4" />
          <span className="hidden lg:inline">Affichage optimisé</span>
        </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => fitView({ padding: 0.2, duration: 300 })} title="Recentrer">
          <Focus className="h-4 w-4" />
        </Button>
      </div>

      {map.owner && (
        <div role="note" className={`flex items-center gap-2 border-b border-line px-3 py-1.5 text-xs ${readOnly ? "bg-amber-50 text-amber-900" : "bg-brand-50 text-brand-700"}`}>
          {readOnly ? <Lock className="h-3.5 w-3.5 shrink-0" /> : <Users className="h-3.5 w-3.5 shrink-0" />}
          <span className="min-w-0 truncate">{readOnly ? `Lecture seule — carte partagée par ${map.owner.name}` : `Carte partagée par ${map.owner.name} (écriture)`}</span>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {/* Canevas */}
        <div ref={wrapperRef} tabIndex={-1} className="relative min-w-0 flex-1 outline-none">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={(_, n) => select(n.id)}
            onNodeDoubleClick={(_, n) => {
              setSelectedId(n.id);
              if (!readOnly) setEditingId(n.id);
            }}
            onNodeDragStop={onNodeDragStop}
            onPaneClick={() => select(null)}
            nodesConnectable={false}
            nodesDraggable={!readOnly}
            nodesFocusable={false}
            elementsSelectable
            selectNodesOnDrag={false}
            deleteKeyCode={null}
            selectionKeyCode={null}
            multiSelectionKeyCode={null}
            minZoom={0.2}
            maxZoom={2.5}
            proOptions={{ hideAttribution: true }}
            fitView
          >
            <Background gap={24} color="var(--color-line-strong)" />
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>

          {/* Barre d'actions du nœud sélectionné */}
          {selected && !editingId && (
            <div className="pointer-events-auto absolute inset-x-2 top-2 flex flex-wrap items-center gap-1 rounded-xl border border-line bg-surface/95 p-1.5 shadow-sm backdrop-blur sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2">
              {!readOnly && (
                <>
                  <Button size="sm" variant="outline" onClick={() => addChild(selected.id)} title="Ajouter un sous-nœud (Tab)">
                    <GitBranchPlus className="h-4 w-4" /> Enfant
                  </Button>
                  {selected.parentId && (
                    <Button size="sm" variant="outline" onClick={() => addSibling(selected.id)} title="Ajouter un nœud frère (Entrée)">
                      <CornerDownRight className="h-4 w-4" /> Frère
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setEditingId(selected.id)} title="Renommer (F2)">
                    Renommer
                  </Button>
                </>
              )}
              {nodes.some((n) => n.parentId === selected.id) && (
                <Button size="sm" variant="outline" onClick={() => toggleCollapse(selected.id)} title="Replier / déplier (Espace)">
                  {selected.collapsed ? "Déplier" : "Replier"}
                </Button>
              )}
              {selected.parentId && !readOnly && (
                <div className="flex items-center overflow-hidden rounded-lg border border-line-strong">
                  {(["OPEN", "WATCH", "CLOSED"] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatus(selected.id, st)}
                      title={NODE_STATUS_LABEL[st]}
                      className={`flex items-center gap-1 px-2 py-1.5 text-xs font-medium ${
                        selected.status === st
                          ? st === "WATCH"
                            ? "bg-amber-100 text-amber-900"
                            : st === "CLOSED"
                              ? "bg-surface-3 text-ink"
                              : "bg-brand-50 text-brand-700"
                          : "text-ink-2 hover:bg-surface-2"
                      }`}
                    >
                      {st === "OPEN" ? <Circle className="h-3.5 w-3.5" /> : st === "WATCH" ? <Eye className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      <span className="hidden sm:inline">{NODE_STATUS_LABEL[st]}</span>
                    </button>
                  ))}
                </div>
              )}
              {!showPanel && (
                <Button size="sm" variant="outline" onClick={() => setPanelOpen(true)} title="Notes et détails">
                  <PanelRightOpen className="h-4 w-4" /> Notes
                </Button>
              )}
              {selected.parentId && !readOnly && (
                <Button size="sm" variant="danger" onClick={() => remove(selected.id)} title="Supprimer (Suppr)">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}

          {nodes.length === 1 && !selected && !readOnly && (
            <div className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-sm text-muted">
              Cliquez sur l&apos;idée centrale puis <kbd className="rounded border border-line-strong bg-surface px-1">Tab</kbd> pour ajouter une branche.
            </div>
          )}
        </div>

        {/* Panneau de détails : colonne à droite (≥ md), tiroir bas (mobile) */}
        {showPanel && selected && (
          <aside role="dialog" aria-label={selected.parentId ? "Détails du nœud" : "Détails de l'idée centrale"} className="fixed inset-x-0 bottom-0 z-30 flex max-h-[70dvh] flex-col rounded-t-2xl border-t border-line bg-surface shadow-2xl md:static md:z-auto md:max-h-none md:w-[26rem] md:rounded-none md:border-l md:border-t-0 md:shadow-none">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">{selected.parentId ? "Nœud" : "Idée centrale"}</span>
              <button type="button" onClick={() => setPanelOpen(false)} className="ml-auto rounded-lg p-2 text-ink-2 hover:bg-surface-2 md:p-1.5" title="Fermer" aria-label="Fermer le panneau">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {readOnly ? (
                <ReadOnlyDetails node={selected} />
              ) : (
              <>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Titre</span>
                <input
                  value={selected.title}
                  onChange={(e) => patchLocal(selected.id, { title: e.target.value })}
                  onBlur={(e) => {
                    const t = e.target.value.trim();
                    if (t) rename(selected.id, t);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 sm:text-sm"
                />
              </label>

              <div className="mt-4">
                <span className="mb-1.5 block text-xs font-medium text-muted">Couleur</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setColor(selected.id, null)}
                    title="Couleur par défaut"
                    aria-label="Couleur par défaut"
                    aria-pressed={!selected.color}
                    className={`h-7 w-7 rounded-full border-2 border-dashed border-line-strong ${!selected.color ? "ring-2 ring-brand-500 ring-offset-2" : ""}`}
                  />
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(selected.id, c)}
                      style={{ backgroundColor: c }}
                      className={`h-7 w-7 rounded-full ${selected.color === c ? "ring-2 ring-brand-500 ring-offset-2" : ""}`}
                      title={`Couleur ${c}`}
                      aria-label={`Couleur ${c}`}
                      aria-pressed={selected.color === c}
                    />
                  ))}
                </div>
              </div>

              {selected.parentId && (
                <div className="mt-4">
                  <span className="mb-1.5 block text-xs font-medium text-muted">Statut</span>
                  <div className="flex flex-wrap gap-1.5 [&_span]:inline">
                  {(["OPEN", "WATCH", "CLOSED"] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatus(selected.id, st)}
                      title={NODE_STATUS_LABEL[st]}
                      className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 ring-1 ring-line text-xs font-medium ${
                        selected.status === st
                          ? st === "WATCH"
                            ? "bg-amber-100 text-amber-900"
                            : st === "CLOSED"
                              ? "bg-surface-3 text-ink"
                              : "bg-brand-50 text-brand-700"
                          : "text-ink-2 hover:bg-surface-2"
                      }`}
                    >
                      {st === "OPEN" ? <Circle className="h-3.5 w-3.5" /> : st === "WATCH" ? <Eye className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      <span className="hidden sm:inline">{NODE_STATUS_LABEL[st]}</span>
                    </button>
                  ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-faint">À surveiller : mis en évidence. Fermé : hachuré et masqué par défaut (avec ses sous-nœuds).</p>
                </div>
              )}
              </>
              )}

              {selected.parentId && !selected.id.startsWith("tmp-") && (
                <NodeTasksPanel
                  mapId={map.id}
                  nodeId={selected.id}
                  readOnly={readOnly}
                  onCounts={(nodeId, counts) => patchLocal(nodeId, counts)}
                />
              )}

              <div className="mt-4">
                <div className="mb-1.5 flex items-center">
                  <span className="text-xs font-medium text-muted">Notes</span>
                  <Link href={`/notes?ref=${selected.parentId ? "node" : "mindmap"}:${real(selected.parentId ? selected.id : map.id)}`} className="ml-auto text-[11px] text-brand-700 hover:underline" title="Ouvrir en grand dans Prise de notes">
                    Ouvrir dans Prise de notes
                  </Link>
                </div>
                {readOnly ? (
                  isBlankNotes(selected.notes) ? (
                    <p className="text-sm text-muted">Aucune note.</p>
                  ) : (
                    // Contenu assaini par sanitizeNotes() (serveur et base locale de l'application).
                    <div className="prose prose-sm max-w-none rounded-lg border border-line bg-surface-2/40 p-3 text-ink-2" dangerouslySetInnerHTML={{ __html: selected.notes }} />
                  )
                ) : (
                  <RichTextEditor
                    key={real(selected.id)}
                    documentKey={real(selected.id)}
                    initialHtml={selected.notes}
                    onChange={(html) => setNotes(selected.id, html)}
                    minHeight={220}
                  />
                )}
              </div>

              {!readOnly && (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => addChild(selected.id)}>
                  <Plus className="h-4 w-4" /> Sous-nœud
                </Button>
                {selected.parentId && (
                  <Button size="sm" variant="danger" onClick={() => remove(selected.id)}>
                    <Trash2 className="h-4 w-4" /> Supprimer
                  </Button>
                )}
              </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {sharing && isOwner && (
        <ShareMapDialog mapId={map.id} mapTitle={map.title} onClose={closeSharing} onCount={(sharedWith) => setMap((m) => ({ ...m, sharedWith }))} />
      )}
    </div>
  );
}

function isBlankNotes(html: string): boolean {
  return !html.includes("<img") && html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim().length === 0;
}

/** Détails d'un nœud en lecture seule (carte partagée en lecture). */
function ReadOnlyDetails({ node }: { node: MindNodeDto }) {
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-muted">Titre</span>
      <p className="flex items-center gap-2 text-sm font-medium">
        {node.color && <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: node.color }} aria-hidden />}
        {node.title}
      </p>
      {node.parentId && (
        <p className="mt-3 text-xs text-muted">
          Statut : <span className="font-medium text-ink-2">{NODE_STATUS_LABEL[node.status]}</span>
        </p>
      )}
    </div>
  );
}
