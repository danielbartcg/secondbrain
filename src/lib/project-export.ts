import "server-only";
import ExcelJS from "exceljs";
import { getProject, type ProjectDto, type TaskDto } from "@/lib/projects";
import { listRisks, type RiskDto } from "@/lib/risks";
import { listMeetings, type MeetingDto } from "@/lib/meetings";
import { htmlToText } from "@/lib/sanitize";
import { prisma } from "@/lib/prisma";
import { RISK_STATUS_LABEL, PROBABILITY_LABELS, SEVERITY_LABELS, BENEFIT_LABELS, riskLevel, levelLabel } from "@/lib/shared/risks";

/**
 * Export Excel complet d'un projet (bouton « Export Excel » de la fiche
 * projet) : un classeur exploitable — en-têtes figés, filtres, dates et
 * pourcentages typés, couleurs de niveau — avec les feuilles Synthèse,
 * Tâches, Étapes & activités, Livrables, Risques & opportunités, Matrices,
 * Réunions, Équipe et Documents. Mêmes droits que la lecture du projet.
 */

const STATUS: Record<string, string> = { TODO: "À faire", IN_PROGRESS: "En cours", DONE: "Terminée", CLOSED: "Clôturée" };
const PRIORITY: Record<string, string> = { LOW: "Basse", MEDIUM: "Moyenne", HIGH: "Haute", CRITICAL: "Critique" };
const COMPLEXITY: Record<string, string> = { LOW: "Basse", MEDIUM: "Moyenne", HIGH: "Forte" };
const PROJECT_STATUS: Record<string, string> = { ACTIVE: "Actif", ON_HOLD: "En pause", DONE: "Terminé", ARCHIVED: "Archivé" };
const DELIVERABLE_STATUS: Record<string, string> = { PLANNED: "Prévu", IN_PROGRESS: "En cours", DELIVERED: "Livré", VALIDATED: "Validé" };
const MEETING_STATUS: Record<string, string> = { draft: "Brouillon", no_review: "Sans validation", pending: "En validation", approved: "Validé", rejected: "Refusé" };
const DECISION: Record<string, string> = { PENDING: "en attente", APPROVED: "validé", REJECTED: "refusé" };

/** Couleurs de niveau (risques : vert → rouge ; opportunités : clair → foncé). */
const RISK_FILL: Record<string, string> = { low: "FFC6EFCE", medium: "FFFFEB9C", high: "FFF8CBAD", critical: "FFFF7C80" };
const OPP_FILL: Record<string, string> = { low: "FFDDF2F0", medium: "FFA8DDD5", high: "FF5FBFB0", critical: "FF2A9D8F" };
const BRAND = "FF3F4EE0";

const day = (iso: string | null | undefined): Date | null => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`) : null);
const text = (html: string | null | undefined, max = 32_000) => (html ? htmlToText(html, max) : "");

function allTasks(p: ProjectDto): Array<{ task: TaskDto; stage: string; activity: string }> {
  const out: Array<{ task: TaskDto; stage: string; activity: string }> = [];
  for (const s of p.stages) {
    for (const a of s.activities) for (const t of a.tasks) out.push({ task: t, stage: s.name, activity: a.name });
    for (const t of s.tasks) out.push({ task: t, stage: s.name, activity: "" });
  }
  for (const t of p.tasks) out.push({ task: t, stage: "", activity: "" });
  return out;
}

/** Feuille-tableau : en-tête stylé, figé, filtre automatique, largeurs. */
function table(wb: ExcelJS.Workbook, name: string, columns: Array<{ header: string; key: string; width: number; numFmt?: string; wrap?: boolean }>, rows: Record<string, unknown>[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width, style: { ...(c.numFmt ? { numFmt: c.numFmt } : {}), alignment: { vertical: "top", wrapText: !!c.wrap } } }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
  head.alignment = { vertical: "middle", wrapText: true };
  head.height = 22;
  for (const r of rows) ws.addRow(r);
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

export async function buildProjectWorkbook(userId: string, projectId: string): Promise<{ buffer: Buffer; filename: string }> {
  const project = await getProject(userId, projectId);
  const [risks, meetings, owner, notesByTask] = await Promise.all([
    listRisks(userId, projectId),
    listMeetings(userId, projectId),
    prisma.user.findUnique({ where: { id: project.ownerId }, select: { name: true } }),
    prisma.task.findMany({ where: { projectId }, select: { id: true, notes: true } }),
  ]);
  const notes = new Map(notesByTask.map((t) => [t.id, t.notes]));
  const members = new Map(project.members.map((m) => [m.id, m]));
  const tasks = allTasks(project);
  const taskName = new Map(tasks.map(({ task }) => [task.id, task.name]));
  const today = new Date().toISOString().slice(0, 10);

  // Références stables : T1… (ordre du plan), R1… / O1… (ordre du registre).
  const taskRef = new Map(tasks.map(({ task }, i) => [task.id, `T${i + 1}`]));
  const riskRef = new Map<string, string>();
  let r = 0;
  let o = 0;
  for (const k of risks) riskRef.set(k.id, k.kind === "RISK" ? `R${++r}` : `O${++o}`);
  const risksByTask = new Map<string, string[]>();
  for (const k of risks) for (const tid of k.taskIds) risksByTask.set(tid, [...(risksByTask.get(tid) ?? []), riskRef.get(k.id)!]);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Second Brain";
  wb.created = new Date();
  wb.title = project.name;

  // --- Synthèse
  const done = tasks.filter(({ task }) => task.status === "DONE" || task.status === "CLOSED").length;
  const late = tasks.filter(({ task }) => task.dueDate && task.dueDate.slice(0, 10) < today && task.status !== "DONE" && task.status !== "CLOSED").length;
  const openRisks = risks.filter((k) => k.kind === "RISK" && k.status !== "CLOSED");
  const summary = wb.addWorksheet("Synthèse");
  summary.columns = [{ width: 32 }, { width: 70 }];
  const title = summary.addRow([project.name]);
  title.font = { bold: true, size: 16, color: { argb: BRAND } };
  summary.addRow([`Export du ${new Date().toLocaleString("fr-FR")}`]).font = { italic: true, color: { argb: "FF6D6C72" } };
  summary.addRow([]);
  const kv: Array<[string, unknown, string?]> = [
    ["Statut", PROJECT_STATUS[project.status] ?? project.status],
    ["Propriétaire", owner?.name ?? ""],
    ["Description", project.description],
    ["Début", day(project.startDate), "dd/mm/yyyy"],
    ["Échéance", day(project.dueDate), "dd/mm/yyyy"],
    ["Avancement global", project.progress.percent / 100, "0%"],
    ["Étapes", project.stages.length],
    ["Tâches", tasks.length],
    ["Tâches terminées ou clôturées", done],
    ["Tâches en retard", late],
    ["Livrables", project.deliverables.length],
    ["Risques ouverts", openRisks.length],
    ["Risques ouverts élevés ou critiques", openRisks.filter((k) => k.level === "high" || k.level === "critical").length],
    ["Opportunités", risks.filter((k) => k.kind === "OPPORTUNITY").length],
    ["Réunions", meetings.length],
    ["Membres de l'équipe", project.members.length],
    ["Notes du projet", text(project.notes, 30_000)],
  ];
  for (const [k, v, fmt] of kv) {
    const row = summary.addRow([k, v ?? ""]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    if (fmt) row.getCell(2).numFmt = fmt;
  }

  // --- Tâches
  table(
    wb,
    "Tâches",
    [
      { header: "Réf.", key: "ref", width: 7 },
      { header: "Étape", key: "stage", width: 22 },
      { header: "Activité", key: "activity", width: 22 },
      { header: "Tâche", key: "name", width: 40, wrap: true },
      { header: "Statut", key: "status", width: 12 },
      { header: "Priorité", key: "priority", width: 10 },
      { header: "Complexité", key: "complexity", width: 11 },
      { header: "Avancement", key: "progress", width: 11, numFmt: "0%" },
      { header: "Début", key: "start", width: 12, numFmt: "dd/mm/yyyy" },
      { header: "Échéance", key: "due", width: 12, numFmt: "dd/mm/yyyy" },
      { header: "Durée (j)", key: "duration", width: 9 },
      { header: "Clôture", key: "closed", width: 12, numFmt: "dd/mm/yyyy" },
      { header: "En retard", key: "late", width: 9 },
      { header: "Responsable", key: "assignee", width: 20 },
      { header: "Superviseur", key: "supervisor", width: 20 },
      { header: "Contributeurs", key: "contributors", width: 28, wrap: true },
      { header: "Prérequis", key: "prereq", width: 30, wrap: true },
      { header: "Risques liés", key: "risks", width: 14 },
      { header: "Commentaires", key: "comments", width: 12 },
      { header: "Description", key: "description", width: 40, wrap: true },
      { header: "Notes", key: "notes", width: 50, wrap: true },
      { header: "Dernière modification", key: "updated", width: 14, numFmt: "dd/mm/yyyy" },
    ],
    tasks.map(({ task: t, stage, activity }) => {
      const s = day(t.startDate ?? t.dueDate);
      const e = day(t.dueDate ?? t.startDate);
      const isLate = !!t.dueDate && t.dueDate.slice(0, 10) < today && t.status !== "DONE" && t.status !== "CLOSED";
      return {
        ref: taskRef.get(t.id),
        stage,
        activity,
        name: t.name,
        status: STATUS[t.status],
        priority: PRIORITY[t.priority],
        complexity: COMPLEXITY[t.complexity],
        progress: t.progress / 100,
        start: day(t.startDate),
        due: day(t.dueDate),
        duration: s && e ? Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1 : null,
        closed: day(t.closedAt),
        late: isLate ? "Oui" : "Non",
        assignee: t.assigneeId ? (members.get(t.assigneeId)?.name ?? "") : "",
        supervisor: t.supervisorId ? (members.get(t.supervisorId)?.name ?? "") : "",
        contributors: t.contributorIds.map((id) => members.get(id)?.name).filter(Boolean).join(", "),
        prereq: (t.prerequisiteIds ?? []).map((id) => `${taskRef.get(id) ?? ""} ${taskName.get(id) ?? ""}`.trim()).join(", "),
        risks: (risksByTask.get(t.id) ?? []).join(", "),
        comments: t.commentCount,
        description: t.description,
        notes: text(notes.get(t.id)),
        updated: new Date(t.updatedAt),
      };
    }),
  ).eachRow((row, i) => {
    if (i > 1 && row.getCell("late").value === "Oui") row.getCell("due").font = { color: { argb: "FFD13B3B" }, bold: true };
  });

  // --- Étapes & activités
  const stageRows: Record<string, unknown>[] = [];
  for (const s of project.stages) {
    stageRows.push({ stage: s.name, activity: "", start: day(s.startDate), due: day(s.dueDate), progress: s.progress.percent / 100, total: s.progress.total, done: s.progress.done, description: s.description });
    for (const a of s.activities) stageRows.push({ stage: s.name, activity: a.name, start: null, due: null, progress: a.progress.percent / 100, total: a.progress.total, done: a.progress.done, description: a.description });
  }
  table(
    wb,
    "Étapes & activités",
    [
      { header: "Étape", key: "stage", width: 28 },
      { header: "Activité", key: "activity", width: 28 },
      { header: "Début", key: "start", width: 12, numFmt: "dd/mm/yyyy" },
      { header: "Échéance", key: "due", width: 12, numFmt: "dd/mm/yyyy" },
      { header: "Avancement", key: "progress", width: 11, numFmt: "0%" },
      { header: "Tâches", key: "total", width: 8 },
      { header: "Terminées", key: "done", width: 10 },
      { header: "Description", key: "description", width: 50, wrap: true },
    ],
    stageRows,
  );

  // --- Livrables
  const stageName = new Map(project.stages.map((s) => [s.id, s.name]));
  table(
    wb,
    "Livrables",
    [
      { header: "Livrable", key: "name", width: 32, wrap: true },
      { header: "Étape", key: "stage", width: 22 },
      { header: "Statut", key: "status", width: 11 },
      { header: "Responsable", key: "assignee", width: 20 },
      { header: "Début prévu", key: "start", width: 12, numFmt: "dd/mm/yyyy" },
      { header: "Fin prévue", key: "end", width: 12, numFmt: "dd/mm/yyyy" },
      { header: "Livré le", key: "delivered", width: 12, numFmt: "dd/mm/yyyy" },
      { header: "Documents", key: "documents", width: 30, wrap: true },
      { header: "Description", key: "description", width: 40, wrap: true },
    ],
    project.deliverables.map((d) => ({
      name: d.name,
      stage: d.stageId ? (stageName.get(d.stageId) ?? "") : "",
      status: DELIVERABLE_STATUS[d.status],
      assignee: d.assigneeId ? (members.get(d.assigneeId)?.name ?? "") : "",
      start: day(d.expectedStart),
      end: day(d.expectedEnd),
      delivered: day(d.deliveredAt),
      documents: d.documents.map((doc) => doc.name).join(", "),
      description: d.description,
    })),
  );

  // --- Risques & opportunités
  const riskSheet = table(
    wb,
    "Risques & opportunités",
    [
      { header: "Réf.", key: "ref", width: 7 },
      { header: "Nature", key: "kind", width: 13 },
      { header: "Titre", key: "title", width: 36, wrap: true },
      { header: "Catégorie", key: "category", width: 16 },
      { header: "Probabilité (1-5)", key: "p", width: 12 },
      { header: "Gravité / bénéfice (1-5)", key: "i", width: 14 },
      { header: "Criticité", key: "score", width: 10 },
      { header: "Niveau", key: "level", width: 11 },
      { header: "Statut", key: "status", width: 16 },
      { header: "Responsable", key: "owner", width: 20 },
      { header: "Échéance", key: "due", width: 12, numFmt: "dd/mm/yyyy" },
      { header: "Plan de traitement / d'exploitation", key: "response", width: 44, wrap: true },
      { header: "Tâches liées", key: "tasks", width: 34, wrap: true },
      { header: "Description", key: "description", width: 40, wrap: true },
    ],
    risks.map((k: RiskDto) => ({
      ref: riskRef.get(k.id),
      kind: k.kind === "RISK" ? "Risque" : "Opportunité",
      title: k.title,
      category: k.category,
      p: k.probability,
      i: k.impact,
      score: k.score,
      level: k.levelLabel,
      status: RISK_STATUS_LABEL[k.status],
      owner: k.ownerName ?? "",
      due: day(k.dueDate),
      response: k.response,
      tasks: k.tasks.map((t) => `${taskRef.get(t.id) ?? ""} ${t.name}`.trim()).join(", "),
      description: k.description,
    })),
  );
  riskSheet.eachRow((row, i) => {
    if (i === 1) return;
    const k = risks[i - 2];
    if (!k) return;
    row.getCell("level").fill = { type: "pattern", pattern: "solid", fgColor: { argb: (k.kind === "RISK" ? RISK_FILL : OPP_FILL)[k.level] } };
  });

  // --- Matrices (probabilité × gravité / bénéfice), éléments non clos
  const matrix = wb.addWorksheet("Matrices");
  matrix.columns = [{ width: 22 }, ...[1, 2, 3, 4, 5].map(() => ({ width: 18 }))];
  const drawMatrix = (kind: "RISK" | "OPPORTUNITY", startRow: number) => {
    const items = risks.filter((k) => k.kind === kind && k.status !== "CLOSED");
    const head = matrix.getRow(startRow);
    head.getCell(1).value = kind === "RISK" ? "Matrice des risques (non clos)" : "Matrice des opportunités (non closes)";
    head.getCell(1).font = { bold: true, size: 13, color: { argb: BRAND } };
    const axis = kind === "RISK" ? SEVERITY_LABELS : BENEFIT_LABELS;
    const labels = matrix.getRow(startRow + 1);
    labels.getCell(1).value = kind === "RISK" ? "Probabilité ↓ / Gravité →" : "Probabilité ↓ / Bénéfice →";
    labels.getCell(1).font = { italic: true };
    axis.forEach((l, j) => {
      labels.getCell(j + 2).value = `${j + 1} · ${l}`;
      labels.getCell(j + 2).font = { bold: true };
      labels.getCell(j + 2).alignment = { horizontal: "center" };
    });
    for (let p = 5; p >= 1; p--) {
      const row = matrix.getRow(startRow + 2 + (5 - p));
      row.height = 42;
      row.getCell(1).value = `${p} · ${PROBABILITY_LABELS[p - 1]}`;
      row.getCell(1).font = { bold: true };
      for (let g = 1; g <= 5; g++) {
        const cell = row.getCell(g + 1);
        const inCell = items.filter((k) => k.probability === p && k.impact === g);
        cell.value = inCell.length ? `${inCell.length} — ${inCell.map((k) => riskRef.get(k.id)).join(", ")}` : `(${p * g})`;
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: (kind === "RISK" ? RISK_FILL : OPP_FILL)[riskLevel(p * g)] } };
        cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
        if (inCell.length) cell.font = { bold: true };
      }
    }
    const legend = matrix.getRow(startRow + 8);
    legend.getCell(1).value = "Niveaux :";
    (["low", "medium", "high", "critical"] as const).forEach((lv, j) => {
      const c = legend.getCell(j + 2);
      c.value = levelLabel(kind, lv);
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: (kind === "RISK" ? RISK_FILL : OPP_FILL)[lv] } };
      c.alignment = { horizontal: "center" };
    });
    return startRow + 10;
  };
  const next = drawMatrix("RISK", 1);
  drawMatrix("OPPORTUNITY", next + 1);

  // --- Réunions
  table(
    wb,
    "Réunions",
    [
      { header: "Date", key: "date", width: 17, numFmt: "dd/mm/yyyy hh:mm" },
      { header: "Titre", key: "title", width: 32, wrap: true },
      { header: "Lieu", key: "location", width: 18 },
      { header: "Rédacteur", key: "author", width: 20 },
      { header: "Participants", key: "participants", width: 32, wrap: true },
      { header: "Validation", key: "status", width: 14 },
      { header: "Validateurs (décision)", key: "approvers", width: 40, wrap: true },
      { header: "Compte-rendu", key: "minutes", width: 80, wrap: true },
    ],
    meetings.map((m: MeetingDto) => ({
      date: new Date(m.date),
      title: m.title,
      location: m.location,
      author: m.authorName,
      participants: m.participants.map((p) => p.name).join(", "),
      status: MEETING_STATUS[m.status],
      approvers: m.approvers.map((a) => `${a.name} : ${DECISION[a.decision]}${a.comment ? ` (« ${a.comment} »)` : ""}`).join("\n"),
      minutes: text(m.minutes),
    })),
  );

  // --- Équipe
  table(
    wb,
    "Équipe",
    [
      { header: "Nom", key: "name", width: 24 },
      { header: "E-mail", key: "email", width: 30 },
      { header: "Rôle", key: "role", width: 20 },
      { header: "Compte", key: "account", width: 9 },
      { header: "Responsable de (tâches)", key: "assigned", width: 14 },
      { header: "Ouvertes", key: "open", width: 10 },
    ],
    project.members.map((m) => {
      const mine = tasks.filter(({ task }) => task.assigneeId === m.id);
      return {
        name: m.name,
        email: m.email ?? "",
        role: m.role ?? "",
        account: m.userId ? "Oui" : "Non",
        assigned: mine.length,
        open: mine.filter(({ task }) => task.status === "TODO" || task.status === "IN_PROGRESS").length,
      };
    }),
  );

  // --- Documents
  const folders = new Map(project.folders.map((f) => [f.id, f]));
  const pathOf = (id: string | null): string => {
    const parts: string[] = [];
    let cur = id ? folders.get(id) : undefined;
    let guard = 0;
    while (cur && guard++ < 50) {
      parts.unshift(cur.name);
      cur = cur.parentId ? folders.get(cur.parentId) : undefined;
    }
    return parts.join(" / ");
  };
  const deliverableName = new Map(project.deliverables.map((d) => [d.id, d.name]));
  table(
    wb,
    "Documents",
    [
      { header: "Document", key: "name", width: 36 },
      { header: "Dossier", key: "folder", width: 28 },
      { header: "Type", key: "type", width: 22 },
      { header: "Taille (Ko)", key: "size", width: 11, numFmt: "#,##0" },
      { header: "Déposé par", key: "by", width: 20 },
      { header: "Date", key: "date", width: 12, numFmt: "dd/mm/yyyy" },
      { header: "Livrable", key: "deliverable", width: 26 },
    ],
    project.documents.map((d) => ({
      name: d.name,
      folder: pathOf(d.folderId),
      type: d.mimeType,
      size: Math.round(d.size / 1024),
      by: d.uploadedBy?.name ?? "",
      date: new Date(d.createdAt),
      deliverable: d.deliverableId ? (deliverableName.get(d.deliverableId) ?? "") : "",
    })),
  );

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const safe = project.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "projet";
  return { buffer, filename: `${safe}-${today}.xlsx` };
}
