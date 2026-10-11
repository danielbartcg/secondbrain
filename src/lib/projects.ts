import "server-only";
import type { Prisma, ProjectStatus, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest, notFound } from "@/lib/api";
import type {
  CreateActivityInput,
  CreateProjectInput,
  CreateStageInput,
  CreateTaskInput,
  UpdateActivityInput,
  UpdateProjectInput,
  UpdateStageInput,
  UpdateTaskInput,
} from "@/lib/schemas";

/**
 * Logique métier de la gestion de projet :
 *   Projet > Étape > (Activité facultative) > Tâche
 *
 * L'avancement n'est saisi QUE sur les tâches ; les niveaux supérieurs
 * l'agrègent (moyenne des tâches, nombre de tâches terminées).
 *
 * Toute mutation s'exécute dans une transaction qui verrouille d'abord la
 * ligne du projet : les mutations concurrentes sur un même projet
 * s'enchaînent au lieu de s'interbloquer.
 */

export type Progress = { percent: number; total: number; done: number };

export type TaskDto = {
  id: string;
  stageId: string;
  activityId: string | null;
  name: string;
  description: string;
  status: TaskStatus;
  progress: number;
  order: number;
  dueDate: string | null;
  updatedAt: string;
};

export type ActivityDto = {
  id: string;
  stageId: string;
  name: string;
  description: string;
  order: number;
  progress: Progress;
  tasks: TaskDto[];
};

export type StageDto = {
  id: string;
  projectId: string;
  name: string;
  description: string;
  order: number;
  startDate: string | null;
  dueDate: string | null;
  progress: Progress;
  activities: ActivityDto[];
  /** Tâches rattachées directement à l'étape (sans activité). */
  tasks: TaskDto[];
};

export type ProjectSummary = {
  id: string;
  name: string;
  description: string;
  color: string | null;
  status: ProjectStatus;
  startDate: string | null;
  dueDate: string | null;
  progress: Progress;
  stageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectDto = ProjectSummary & { stages: StageDto[] };

type Tx = Prisma.TransactionClient;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const toDate = (v: string | null | undefined): Date | null | undefined =>
  v === undefined ? undefined : v === null ? null : new Date(v);

export function aggregate(progresses: number[]): Progress {
  const total = progresses.length;
  if (total === 0) return { percent: 0, total: 0, done: 0 };
  const sum = progresses.reduce((a, b) => a + b, 0);
  return {
    percent: Math.round(sum / total),
    total,
    done: progresses.filter((p) => p >= 100).length,
  };
}

type TaskRow = {
  id: string;
  stageId: string;
  activityId: string | null;
  name: string;
  description: string;
  status: TaskStatus;
  progress: number;
  order: number;
  dueDate: Date | null;
  updatedAt: Date;
};

function toTaskDto(t: TaskRow): TaskDto {
  return {
    id: t.id,
    stageId: t.stageId,
    activityId: t.activityId,
    name: t.name,
    description: t.description,
    status: t.status,
    progress: t.progress,
    order: t.order,
    dueDate: iso(t.dueDate),
    updatedAt: t.updatedAt.toISOString(),
  };
}

const PROJECT_INCLUDE = {
  stages: {
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    include: {
      activities: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
      tasks: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
    },
  },
} satisfies Prisma.ProjectInclude;

type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof PROJECT_INCLUDE }>;

function toProjectDto(p: ProjectRow): ProjectDto {
  const stages: StageDto[] = p.stages.map((s) => {
    const activities: ActivityDto[] = s.activities.map((a) => {
      const tasks = s.tasks.filter((t) => t.activityId === a.id).map(toTaskDto);
      return {
        id: a.id,
        stageId: a.stageId,
        name: a.name,
        description: a.description,
        order: a.order,
        progress: aggregate(tasks.map((t) => t.progress)),
        tasks,
      };
    });
    const directTasks = s.tasks.filter((t) => t.activityId === null).map(toTaskDto);
    return {
      id: s.id,
      projectId: s.projectId,
      name: s.name,
      description: s.description,
      order: s.order,
      startDate: iso(s.startDate),
      dueDate: iso(s.dueDate),
      progress: aggregate(s.tasks.map((t) => t.progress)),
      activities,
      tasks: directTasks,
    };
  });
  const allTasks = p.stages.flatMap((s) => s.tasks);
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    color: p.color,
    status: p.status,
    startDate: iso(p.startDate),
    dueDate: iso(p.dueDate),
    progress: aggregate(allTasks.map((t) => t.progress)),
    stageCount: p.stages.length,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    stages,
  };
}

// --- Accès et verrouillage ---------------------------------------------------

async function ownedProjectId(userId: string, projectId: string): Promise<string> {
  const p = await prisma.project.findFirst({ where: { id: projectId, ownerId: userId }, select: { id: true } });
  if (!p) throw notFound("Projet");
  return p.id;
}

async function stageProjectId(userId: string, stageId: string): Promise<string> {
  const s = await prisma.stage.findFirst({ where: { id: stageId, project: { ownerId: userId } }, select: { projectId: true } });
  if (!s) throw notFound("Étape");
  return s.projectId;
}

async function activityProjectId(userId: string, activityId: string): Promise<string> {
  const a = await prisma.activity.findFirst({
    where: { id: activityId, stage: { project: { ownerId: userId } } },
    select: { stage: { select: { projectId: true } } },
  });
  if (!a) throw notFound("Activité");
  return a.stage.projectId;
}

async function taskProjectId(userId: string, taskId: string): Promise<string> {
  const t = await prisma.task.findFirst({
    where: { id: taskId, stage: { project: { ownerId: userId } } },
    select: { stage: { select: { projectId: true } } },
  });
  if (!t) throw notFound("Tâche");
  return t.stage.projectId;
}

/** Transaction sérialisée sur le projet (verrou de ligne), puis projet recalculé. */
async function mutateProject(projectId: string, fn: (tx: Tx) => Promise<void>): Promise<ProjectDto> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
      await fn(tx);
      const p = await tx.project.update({
        where: { id: projectId },
        data: { updatedAt: new Date() },
        include: PROJECT_INCLUDE,
      });
      return toProjectDto(p);
    },
    { timeout: 15_000 },
  );
}

/** Renumérote des frères (étapes, activités ou tâches) ; `moveId` inséré à `index` si fourni. */
async function resequence(
  tx: Tx,
  model: "stage" | "activity" | "task",
  where: Record<string, unknown>,
  moveId?: string,
  index?: number,
) {
  const delegate = tx[model] as unknown as {
    findMany: (args: unknown) => Promise<Array<{ id: string; order: number }>>;
    update: (args: unknown) => Promise<unknown>;
  };
  const rows = await delegate.findMany({
    where: { ...where, ...(moveId ? { NOT: { id: moveId } } : {}) },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, order: true },
  });
  const ids = rows.map((r) => r.id);
  if (moveId) {
    const at = index === undefined ? ids.length : Math.min(index, ids.length);
    ids.splice(at, 0, moveId);
  }
  const current = new Map(rows.map((r) => [r.id, r.order]));
  for (let order = 0; order < ids.length; order++) {
    if (current.get(ids[order]) === order) continue;
    await delegate.update({ where: { id: ids[order] }, data: { order } });
  }
}

// --- Projets -----------------------------------------------------------------

export async function listProjects(userId: string): Promise<ProjectSummary[]> {
  const rows = await prisma.project.findMany({
    where: { ownerId: userId },
    orderBy: { updatedAt: "desc" },
    include: PROJECT_INCLUDE,
  });
  return rows.map((p) => {
    const { stages: _stages, ...summary } = toProjectDto(p);
    void _stages;
    return summary;
  });
}

export async function getProject(userId: string, projectId: string): Promise<ProjectDto> {
  const p = await prisma.project.findFirst({ where: { id: projectId, ownerId: userId }, include: PROJECT_INCLUDE });
  if (!p) throw notFound("Projet");
  return toProjectDto(p);
}

export async function createProject(userId: string, input: CreateProjectInput): Promise<ProjectDto> {
  const p = await prisma.project.create({
    data: {
      ownerId: userId,
      name: input.name,
      description: input.description,
      color: input.color ?? null,
      status: input.status ?? "ACTIVE",
      startDate: toDate(input.startDate) ?? null,
      dueDate: toDate(input.dueDate) ?? null,
    },
  });
  return getProject(userId, p.id);
}

export async function updateProject(userId: string, projectId: string, input: UpdateProjectInput): Promise<ProjectDto> {
  await ownedProjectId(userId, projectId);
  return mutateProject(projectId, async (tx) => {
    await tx.project.update({
      where: { id: projectId },
      data: {
        name: input.name,
        description: input.description,
        color: input.color,
        status: input.status,
        startDate: toDate(input.startDate),
        dueDate: toDate(input.dueDate),
      },
    });
  });
}

export async function deleteProject(userId: string, projectId: string): Promise<void> {
  await ownedProjectId(userId, projectId);
  await prisma.project.delete({ where: { id: projectId } });
}

// --- Étapes ------------------------------------------------------------------

export async function createStage(userId: string, projectId: string, input: CreateStageInput): Promise<ProjectDto> {
  await ownedProjectId(userId, projectId);
  return mutateProject(projectId, async (tx) => {
    const count = await tx.stage.count({ where: { projectId } });
    await tx.stage.create({
      data: {
        projectId,
        name: input.name,
        description: input.description,
        order: count,
        startDate: toDate(input.startDate) ?? null,
        dueDate: toDate(input.dueDate) ?? null,
      },
    });
  });
}

export async function updateStage(userId: string, stageId: string, input: UpdateStageInput): Promise<ProjectDto> {
  const projectId = await stageProjectId(userId, stageId);
  return mutateProject(projectId, async (tx) => {
    await tx.stage.update({
      where: { id: stageId },
      data: {
        name: input.name,
        description: input.description,
        startDate: toDate(input.startDate),
        dueDate: toDate(input.dueDate),
      },
    });
    if (input.order !== undefined) await resequence(tx, "stage", { projectId }, stageId, input.order);
  });
}

export async function deleteStage(userId: string, stageId: string): Promise<ProjectDto> {
  const projectId = await stageProjectId(userId, stageId);
  return mutateProject(projectId, async (tx) => {
    await tx.stage.delete({ where: { id: stageId } });
    await resequence(tx, "stage", { projectId });
  });
}

// --- Activités ---------------------------------------------------------------

export async function createActivity(userId: string, stageId: string, input: CreateActivityInput): Promise<ProjectDto> {
  const projectId = await stageProjectId(userId, stageId);
  return mutateProject(projectId, async (tx) => {
    const count = await tx.activity.count({ where: { stageId } });
    await tx.activity.create({ data: { stageId, name: input.name, description: input.description, order: count } });
  });
}

export async function updateActivity(userId: string, activityId: string, input: UpdateActivityInput): Promise<ProjectDto> {
  const projectId = await activityProjectId(userId, activityId);
  return mutateProject(projectId, async (tx) => {
    const a = await tx.activity.update({
      where: { id: activityId },
      data: { name: input.name, description: input.description },
    });
    if (input.order !== undefined) await resequence(tx, "activity", { stageId: a.stageId }, activityId, input.order);
  });
}

export async function deleteActivity(userId: string, activityId: string): Promise<ProjectDto> {
  const projectId = await activityProjectId(userId, activityId);
  return mutateProject(projectId, async (tx) => {
    const a = await tx.activity.delete({ where: { id: activityId } });
    await resequence(tx, "activity", { stageId: a.stageId });
  });
}

// --- Tâches ------------------------------------------------------------------

/** Cohérence statut / avancement : DONE ⇔ 100 %, TODO ⇔ 0 %, sinon IN_PROGRESS. */
export function reconcile(
  current: { status: TaskStatus; progress: number },
  input: { status?: TaskStatus; progress?: number },
): { status: TaskStatus; progress: number } {
  let { status, progress } = current;
  if (input.progress !== undefined) {
    progress = input.progress;
    status = progress >= 100 ? "DONE" : progress <= 0 ? "TODO" : "IN_PROGRESS";
  }
  if (input.status !== undefined) {
    status = input.status;
    if (status === "DONE") progress = 100;
    else if (status === "TODO") progress = 0;
    else if (progress <= 0 || progress >= 100) progress = 50;
  }
  return { status, progress };
}

export async function createTask(
  userId: string,
  target: { stageId?: string; activityId?: string },
  input: CreateTaskInput,
): Promise<ProjectDto> {
  const projectId = target.activityId
    ? await activityProjectId(userId, target.activityId)
    : target.stageId
      ? await stageProjectId(userId, target.stageId)
      : null;
  if (!projectId) throw badRequest("stageId ou activityId requis.");

  return mutateProject(projectId, async (tx) => {
    let stageId: string;
    let activityId: string | null = null;
    if (target.activityId) {
      const a = await tx.activity.findUniqueOrThrow({ where: { id: target.activityId } });
      stageId = a.stageId;
      activityId = a.id;
    } else {
      stageId = target.stageId!;
    }
    const { status, progress } = reconcile({ status: "TODO", progress: 0 }, input);
    const count = await tx.task.count({ where: { stageId, activityId } });
    await tx.task.create({
      data: {
        stageId,
        activityId,
        name: input.name,
        description: input.description,
        status,
        progress,
        order: count,
        dueDate: toDate(input.dueDate) ?? null,
      },
    });
  });
}

export async function updateTask(userId: string, taskId: string, input: UpdateTaskInput): Promise<ProjectDto> {
  const projectId = await taskProjectId(userId, taskId);
  return mutateProject(projectId, async (tx) => {
    const t = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
    const { status, progress } = reconcile(t, input);

    // Déplacement éventuel vers une autre activité / étape du même projet.
    let stageId = t.stageId;
    let activityId = t.activityId;
    if (input.activityId !== undefined) {
      if (input.activityId === null) {
        activityId = null;
        if (input.stageId) {
          const s = await tx.stage.findFirst({ where: { id: input.stageId, projectId } });
          if (!s) throw badRequest("Déplacement hors du projet impossible.");
          stageId = s.id;
        }
      } else {
        const a = await tx.activity.findFirst({ where: { id: input.activityId, stage: { projectId } } });
        if (!a) throw badRequest("Déplacement hors du projet impossible.");
        activityId = a.id;
        stageId = a.stageId;
      }
    } else if (input.stageId && input.stageId !== t.stageId) {
      const s = await tx.stage.findFirst({ where: { id: input.stageId, projectId } });
      if (!s) throw badRequest("Déplacement hors du projet impossible.");
      stageId = s.id;
      activityId = null;
    }
    const moved = stageId !== t.stageId || activityId !== t.activityId;

    await tx.task.update({
      where: { id: taskId },
      data: {
        name: input.name,
        description: input.description,
        status,
        progress,
        dueDate: toDate(input.dueDate),
        stageId,
        activityId,
        ...(moved ? { order: 1_000_000 } : {}),
      },
    });
    if (moved || input.order !== undefined) {
      await resequence(tx, "task", { stageId, activityId }, taskId, input.order);
      if (moved) await resequence(tx, "task", { stageId: t.stageId, activityId: t.activityId });
    }
  });
}

export async function deleteTask(userId: string, taskId: string): Promise<ProjectDto> {
  const projectId = await taskProjectId(userId, taskId);
  return mutateProject(projectId, async (tx) => {
    const t = await tx.task.delete({ where: { id: taskId } });
    await resequence(tx, "task", { stageId: t.stageId, activityId: t.activityId });
  });
}
