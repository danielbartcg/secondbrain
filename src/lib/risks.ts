import "server-only";
import type { Prisma, RiskKind, RiskStatus, RiskStrategy, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest, notFound } from "@/lib/api";
import { projectEditWhere, requireProjectAccess } from "@/lib/projects";
import { isAdmin } from "@/lib/roles";
import { actorDisplayName, recordTaskEvents, type TaskEventInput } from "@/lib/task-events";
import { KIND_NOUN, levelLabel, riskLevel, riskScore, type RiskLevel } from "@/lib/shared/risks";
import type { CreateRiskInput, UpdateRiskInput } from "@/lib/schemas-risks";

/**
 * Gestion des risques et opportunités d'un projet : registre déclaratif
 * (probabilité × gravité / bénéfice, statut, responsable, plan de traitement)
 * et liens vers les tâches du projet.
 *
 * Accès : propriétaire et membres rattachés lisent et modifient ; un
 * administrateur consulte n'importe quel projet en **lecture seule**
 * (`listRisks`), jamais en écriture. Les mutations verrouillent la ligne du
 * projet (comme `mutateProject`) pour s'enchaîner sans interblocage.
 *
 * Toute mutation renvoie la liste complète des risques du projet.
 */

type Tx = Prisma.TransactionClient;

export type RiskTaskRef = { id: string; name: string; status: TaskStatus };

export type RiskDto = {
  id: string;
  projectId: string;
  kind: RiskKind;
  title: string;
  description: string;
  category: string;
  probability: number;
  impact: number;
  /** probabilité × impact (1..25). */
  score: number;
  level: RiskLevel;
  levelLabel: string;
  status: RiskStatus;
  ownerId: string | null;
  ownerName: string | null;
  response: string;
  /** Stratégie de gestion / de maximisation ; null = non définie. */
  strategy: RiskStrategy | null;
  order: number;
  taskIds: string[];
  tasks: RiskTaskRef[];
  createdAt: string;
  updatedAt: string;
};

const RISK_INCLUDE = {
  owner: { select: { id: true, name: true } },
  tasks: { include: { task: { select: { id: true, name: true, status: true } } } },
} satisfies Prisma.RiskInclude;

type RiskRow = Prisma.RiskGetPayload<{ include: typeof RISK_INCLUDE }>;

function toRiskDto(r: RiskRow): RiskDto {
  const score = riskScore(r.probability, r.impact);
  const level = riskLevel(score);
  const tasks = r.tasks.map((l) => l.task).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return {
    id: r.id,
    projectId: r.projectId,
    kind: r.kind,
    title: r.title,
    description: r.description,
    category: r.category,
    probability: r.probability,
    impact: r.impact,
    score,
    level,
    levelLabel: levelLabel(r.kind, level),
    status: r.status,
    ownerId: r.ownerId,
    ownerName: r.owner?.name ?? null,
    response: r.response,
    strategy: r.strategy,
    order: r.order,
    taskIds: tasks.map((t) => t.id),
    tasks,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

async function fetchRisks(db: Tx | typeof prisma, projectId: string): Promise<RiskDto[]> {
  const rows = await db.risk.findMany({ where: { projectId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }], include: RISK_INCLUDE });
  return rows.map(toRiskDto);
}

/** Transaction verrouillant la ligne du projet, puis liste recalculée. */
async function mutateRisks(projectId: string, fn: (tx: Tx) => Promise<void>): Promise<RiskDto[]> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
      await fn(tx);
      return fetchRisks(tx, projectId);
    },
    { timeout: 15_000 },
  );
}

/** Le responsable doit être un membre du même projet. */
async function checkOwner(tx: Tx, projectId: string, ownerId: string | null | undefined) {
  if (!ownerId) return;
  const m = await tx.projectMember.findFirst({ where: { id: ownerId, projectId }, select: { id: true } });
  if (!m) throw badRequest("Le responsable doit être un membre du projet.");
}

/** Risque accessible (propriétaire ou membre du projet) ; 404 sinon. */
async function accessibleRisk(userId: string, riskId: string) {
  const r = await prisma.risk.findFirst({ where: { id: riskId, project: (await projectEditWhere(userId)) }, select: { id: true, projectId: true } });
  if (!r) throw notFound("Risque");
  return r;
}

// --- Lecture -------------------------------------------------------------------

/**
 * Registre des risques et opportunités du projet (ordre, puis création).
 * Propriétaire / membre, ou administrateur en consultation (lecture seule).
 */
export async function listRisks(userId: string, projectId: string): Promise<RiskDto[]> {
  try {
    await requireProjectAccess(userId, projectId);
  } catch (e) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, role: true } });
    if (!user || !isAdmin(user)) throw e;
    const exists = await prisma.project.count({ where: { id: projectId } });
    if (!exists) throw notFound("Projet");
  }
  return fetchRisks(prisma, projectId);
}

// --- Mutations -----------------------------------------------------------------

export async function createRisk(userId: string, projectId: string, input: CreateRiskInput): Promise<RiskDto[]> {
  await requireProjectAccess(userId, projectId);
  return mutateRisks(projectId, async (tx) => {
    await checkOwner(tx, projectId, input.ownerId);
    const last = await tx.risk.aggregate({ where: { projectId }, _max: { order: true } });
    await tx.risk.create({
      data: {
        projectId,
        kind: input.kind,
        title: input.title,
        description: input.description,
        category: input.category,
        probability: input.probability,
        impact: input.impact,
        status: input.status,
        ownerId: input.ownerId ?? null,
        response: input.response,
        strategy: input.strategy ?? null,
        order: (last._max.order ?? -1) + 1,
      },
    });
  });
}

export async function updateRisk(userId: string, riskId: string, input: UpdateRiskInput): Promise<RiskDto[]> {
  const { projectId } = await accessibleRisk(userId, riskId);
  return mutateRisks(projectId, async (tx) => {
    await checkOwner(tx, projectId, input.ownerId);
    await tx.risk.update({
      where: { id: riskId },
      data: {
        kind: input.kind,
        title: input.title,
        description: input.description,
        category: input.category,
        probability: input.probability,
        impact: input.impact,
        status: input.status,
        ownerId: input.ownerId,
        response: input.response,
        strategy: input.strategy,
        order: input.order,
      },
    });
  });
}

/** Supprime le risque ; la suppression est tracée sur les tâches qui y étaient liées. */
export async function deleteRisk(userId: string, riskId: string): Promise<RiskDto[]> {
  const { projectId } = await accessibleRisk(userId, riskId);
  return mutateRisks(projectId, async (tx) => {
    const risk = await tx.risk.findUnique({ where: { id: riskId }, select: { kind: true, title: true, tasks: { select: { taskId: true } } } });
    if (!risk) throw notFound("Risque");
    if (risk.tasks.length > 0) {
      const actorName = await actorDisplayName(tx, userId);
      await recordTaskEvents(
        tx,
        risk.tasks.map(({ taskId }) => ({
          taskId,
          actorId: userId,
          actorName,
          kind: "risk",
          field: "risk",
          oldValue: risk.title,
          newValue: null,
          message: `${actorName} a supprimé ${KIND_NOUN[risk.kind].def} « ${risk.title} » (lien retiré)`,
        })),
      );
    }
    await tx.risk.delete({ where: { id: riskId } });
  });
}

/**
 * Remplace les tâches liées au risque. Les tâches doivent appartenir au même
 * projet (400 sinon). Chaque lien ajouté ou retiré est tracé sur la tâche.
 */
export async function setRiskTasks(userId: string, riskId: string, taskIds: string[]): Promise<RiskDto[]> {
  const { projectId } = await accessibleRisk(userId, riskId);
  const wanted = [...new Set(taskIds)];
  return mutateRisks(projectId, async (tx) => {
    const risk = await tx.risk.findUnique({ where: { id: riskId }, select: { kind: true, title: true, tasks: { select: { taskId: true } } } });
    if (!risk) throw notFound("Risque");
    if (wanted.length > 0) {
      const found = await tx.task.count({ where: { id: { in: wanted }, projectId } });
      if (found !== wanted.length) throw badRequest("Seules les tâches du projet peuvent être liées.");
    }
    const current = new Set(risk.tasks.map((t) => t.taskId));
    const target = new Set(wanted);
    const added = wanted.filter((id) => !current.has(id));
    const removed = [...current].filter((id) => !target.has(id));
    if (added.length === 0 && removed.length === 0) return;

    if (removed.length > 0) await tx.riskTask.deleteMany({ where: { riskId, taskId: { in: removed } } });
    if (added.length > 0) await tx.riskTask.createMany({ data: added.map((taskId) => ({ riskId, taskId })), skipDuplicates: true });

    const actorName = await actorDisplayName(tx, userId);
    const noun = KIND_NOUN[risk.kind].def;
    const events: TaskEventInput[] = [
      ...added.map(
        (taskId): TaskEventInput => ({
          taskId,
          actorId: userId,
          actorName,
          kind: "risk",
          field: "risk",
          oldValue: null,
          newValue: risk.title,
          message: `${actorName} a lié la tâche ${KIND_NOUN[risk.kind].to} « ${risk.title} »`,
        }),
      ),
      ...removed.map(
        (taskId): TaskEventInput => ({
          taskId,
          actorId: userId,
          actorName,
          kind: "risk",
          field: "risk",
          oldValue: risk.title,
          newValue: null,
          message: `${actorName} a retiré le lien avec ${noun} « ${risk.title} »`,
        }),
      ),
    ];
    await recordTaskEvents(tx, events);
  });
}

// --- Tableau de bord ------------------------------------------------------------

/** Risque vu du tableau de bord : avec son projet. */
export type RiskOverviewItem = RiskDto & { projectName: string; projectColor: string | null };
export type RiskOverviewScope = "mine" | "projects";
export type RiskOverview = {
  scope: RiskOverviewScope;
  /** Vrai si l'utilisateur possède au moins un projet actif : l'option « Tous les risques de mes projets » est alors disponible. */
  ownsProjects: boolean;
  risks: RiskOverviewItem[];
};

/**
 * Matrice des risques du tableau de bord (risques non clos des projets actifs
 * ou en pause) : `mine` = risques dont je suis responsable (membre rattaché à
 * mon compte), dans mon périmètre ; `projects` = tous les risques des projets
 * dont je suis propriétaire. Sans projet possédé, `projects` retombe sur `mine`.
 */
export async function getRiskOverview(userId: string, scope: RiskOverviewScope): Promise<RiskOverview> {
  const liveProject: Prisma.ProjectWhereInput = { isTemplate: false, status: { in: ["ACTIVE", "ON_HOLD"] } };
  const ownsProjects = (await prisma.project.count({ where: { ...liveProject, ownerId: userId } })) > 0;
  const effective: RiskOverviewScope = scope === "projects" && ownsProjects ? "projects" : "mine";
  const project: Prisma.ProjectWhereInput =
    effective === "projects" ? { ...liveProject, ownerId: userId } : { ...liveProject, OR: [{ ownerId: userId }, { members: { some: { userId } } }] };
  const rows = await prisma.risk.findMany({
    where: { kind: "RISK", status: { not: "CLOSED" }, project, ...(effective === "mine" ? { owner: { userId } } : {}) },
    include: { ...RISK_INCLUDE, project: { select: { name: true, color: true } } },
    orderBy: [{ updatedAt: "desc" }],
    take: 500,
  });
  const risks = rows
    .map((r) => ({ ...toRiskDto(r), projectName: r.project.name, projectColor: r.project.color }))
    .sort((a, b) => b.score - a.score || a.projectName.localeCompare(b.projectName, "fr") || a.title.localeCompare(b.title, "fr"));
  return { scope: effective, ownsProjects, risks };
}
