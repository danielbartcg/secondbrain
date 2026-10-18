import "server-only";
import { prisma } from "@/lib/prisma";
import { mapAccessWhere } from "@/lib/map-access";
import { getDocument, type NoteDocument } from "@/lib/notes";
import { hasHtmlContent, projectAccessWhere, taskAccessWhere } from "@/lib/projects";
import { htmlToText } from "@/lib/sanitize";
import { MIN_AGE_DAYS, pickDaily, reviewCard, type ResurfaceAnswer } from "@/lib/shared/leitner";

/**
 * Résurgence (tableau de bord « À relire aujourd'hui ») : chaque jour,
 * quelques notes anciennes de Prise de notes reviennent à la surface selon la
 * répétition espacée (boîtes de Leitner, `src/lib/shared/leitner.ts`).
 * Candidates : objets accessibles (tâches, projets, étapes, activités, cartes
 * et nœuds — hors modèles) dont les notes ne sont pas vides et n'ont pas été
 * modifiées depuis 30 jours. Une carte (`ResurfaceCard`) n'existe qu'après la
 * première réponse. En ligne uniquement.
 */

const DAY_MS = 86_400_000;
const EMPTY = ["", "<p></p>"];
const CANDIDATES_PER_KIND = 3000;

export type ResurfaceItem = {
  ref: string;
  kind: string;
  title: string;
  /** Page de l'objet (fiche tâche, projet, carte…). */
  href: string | null;
  /** Fil d'Ariane lisible (« Projet › Étape »). */
  context: string;
  excerpt: string;
  /** 0 = jamais relue. */
  box: number;
  updatedAt: string | null;
  lastReviewedAt: string | null;
};

/** Références des notes candidates (jamais encore relues ou non). */
async function freshCandidates(userId: string, now: Date): Promise<string[]> {
  const old = { lt: new Date(now.getTime() - MIN_AGE_DAYS * DAY_MS) };
  const notes = { notIn: EMPTY };
  const take = CANDIDATES_PER_KIND;
  const [tasks, projects, stages, activities, nodes] = await Promise.all([
    prisma.task.findMany({ where: { ...taskAccessWhere(userId), notes, updatedAt: old }, select: { id: true }, take }),
    prisma.project.findMany({ where: { ...projectAccessWhere(userId), notes, updatedAt: old }, select: { id: true }, take }),
    prisma.stage.findMany({ where: { project: projectAccessWhere(userId), notes, updatedAt: old }, select: { id: true }, take }),
    prisma.activity.findMany({ where: { stage: { project: projectAccessWhere(userId) }, notes, updatedAt: old }, select: { id: true }, take }),
    prisma.mindNode.findMany({ where: { map: mapAccessWhere(userId), notes, updatedAt: old }, select: { id: true, parentId: true, mapId: true }, take }),
  ]);
  return [
    ...tasks.map((x) => `task:${x.id}`),
    ...projects.map((x) => `project:${x.id}`),
    ...stages.map((x) => `stage:${x.id}`),
    ...activities.map((x) => `activity:${x.id}`),
    ...nodes.map((x) => (x.parentId === null ? `mindmap:${x.mapId}` : `node:${x.id}`)),
  ];
}

async function documentOrNull(userId: string, ref: string): Promise<NoteDocument | null> {
  try {
    const doc = await getDocument(userId, ref);
    return hasHtmlContent(doc.notes) ? doc : null;
  } catch {
    return null;
  }
}

/** Notes à relire aujourd'hui (3 au plus). */
export async function getResurface(userId: string, now = new Date()): Promise<ResurfaceItem[]> {
  const [cards, fresh] = await Promise.all([
    prisma.resurfaceCard.findMany({ where: { userId }, select: { ref: true, box: true, dueAt: true, lastReviewedAt: true, archived: true } }),
    freshCandidates(userId, now),
  ]);
  const byRef = new Map(cards.map((c) => [c.ref, c]));
  const excluded = new Set<string>();
  // Une note devenue inaccessible ou vide est écartée (et sa carte supprimée), puis on recomplète.
  for (let attempt = 0; attempt < 4; attempt++) {
    const refs = pickDaily(
      cards.filter((c) => !excluded.has(c.ref)),
      fresh.filter((r) => !excluded.has(r)),
      { userId, now },
    );
    const docs = await Promise.all(refs.map((r) => documentOrNull(userId, r)));
    const bad = refs.filter((_, i) => !docs[i]);
    if (bad.length === 0) {
      return docs.map((doc, i) => {
        const card = byRef.get(refs[i]);
        return {
          ref: refs[i],
          kind: doc!.kind,
          title: doc!.title,
          href: doc!.href,
          context: doc!.breadcrumb.map((b) => b.title).join(" › "),
          excerpt: htmlToText(doc!.notes, 320),
          box: card?.box ?? 0,
          updatedAt: doc!.updatedAt,
          lastReviewedAt: card?.lastReviewedAt?.toISOString() ?? null,
        };
      });
    }
    for (const r of bad) excluded.add(r);
    const stale = bad.filter((r) => byRef.has(r));
    if (stale.length) await prisma.resurfaceCard.deleteMany({ where: { userId, ref: { in: stale } } });
  }
  return [];
}

/** Réponse à une note du jour ; renvoie la liste à jour. */
export async function reviewResurface(userId: string, ref: string, answer: ResurfaceAnswer, now = new Date()): Promise<ResurfaceItem[]> {
  // Contrôle d'accès : getDocument lève 404 si l'objet n'est pas lisible.
  await getDocument(userId, ref);
  const card = await prisma.resurfaceCard.findUnique({ where: { userId_ref: { userId, ref } }, select: { box: true } });
  const next = reviewCard(card?.box ?? 0, answer, now);
  await prisma.resurfaceCard.upsert({
    where: { userId_ref: { userId, ref } },
    create: { userId, ref, ...next, lastReviewedAt: now },
    update: { ...next, lastReviewedAt: now },
  });
  return getResurface(userId, now);
}
