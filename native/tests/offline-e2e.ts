/**
 * Tests de bout en bout du client hors ligne de l'application native
 * (native/src/local) : la vraie couche locale (magasin, API locale, moteur de
 * synchro) tourne dans Node avec une IndexedDB simulée, face au serveur de dev.
 *
 * Usage (serveur de dev lancé, inscriptions ouvertes) :
 *   npm run test:native            # http://localhost:3000
 *   BASE_URL=http://localhost:3001 npm run test:native
 *
 * Scénario : A utilise l'application (hors ligne / en ligne) ; B utilise le
 * site web en parallèle (API REST directe).
 */
import "fake-indexeddb/auto";
import { randomBytes } from "node:crypto";
import { createRuntime, type Runtime } from "../src/local/runtime";
import { setForcedOffline } from "../src/local/remote";
import { mediaRewriter } from "../src/local/platform";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
let passes = 0;
let failures = 0;
function check(name: string, cond: unknown, detail?: unknown) {
  if (cond) {
    passes++;
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail, null, 1).slice(0, 1200));
  }
}

// --- Utilisateur « web » (B) : appels REST directs -----------------------------------------
async function http<T = any>(method: string, path: string, token: string | null, body?: unknown): Promise<{ status: number; data: T }> {
  const r = await fetch(BASE + "/api/v1" + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: (await r.json().catch(() => ({}))) as T };
}
async function register(label: string) {
  const email = `native-${label}-${randomBytes(4).toString("hex")}@test.local`;
  const r = await http<{ token: string; user: { id: string } }>("POST", "/auth/register", null, { email, password: "Password123!", firstName: `Native${label}`, lastName: "Test" });
  if (r.status !== 201) throw new Error(`register ${r.status} ${JSON.stringify(r.data)}`);
  return { email, token: r.data.token, id: r.data.user.id };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

async function main() {
  console.log(`Client hors ligne — ${BASE}`);
  const A = await register("A");
  const B = await register("B");
  const rt: Runtime = await createRuntime({ dbName: "sb-test-" + randomBytes(4).toString("hex") });
  const api = (m: string, p: string, b?: unknown) => rt.handle(m, p, b) as Promise<Any>;

  console.log("\n1. Connexion et premier instantané");
  await rt.signIn(BASE, A.email, "Password123!");
  check("connecté, profil local", rt.store.meta.user?.id === A.id && !!rt.store.meta.token);
  check("instantané reçu (curseur > 0)", rt.store.meta.cursor > 0, rt.store.meta.cursor);
  check("aucune erreur de synchro", !rt.sync.status.lastError, rt.sync.status);

  console.log("\n2. Écritures en ligne : projet, étape, tâche, carte");
  const { project } = await api("POST", "/projects", { name: "Projet appli" });
  const pid = project.id as string;
  check("projet visible immédiatement (membre provisoire)", project.members.length === 1 && project.members[0].userId === A.id);
  const afterStage = await api("POST", `/projects/${pid}/stages`, { name: "Étape 1" });
  const stageId = afterStage.project.stages[0].id as string;
  const t1 = await api("POST", `/stages/${stageId}/tasks`, { name: "Tâche partagée", priority: "HIGH" });
  const taskId = t1.task.id as string;
  const { mindmap } = await api("POST", "/mindmaps", { title: "Carte appli" });
  const mapId = mindmap.id as string;
  const { node } = await api("POST", `/mindmaps/${mapId}/nodes`, { parentId: mindmap.rootId, title: "Idée" });
  check("file d'attente : 5 créations", rt.store.outbox.length === 5, rt.store.outbox.map((o) => `${o.entity}:${o.op}`));
  await rt.sync.syncNow();
  check("file vidée après synchro", rt.store.outbox.length === 0, rt.store.outbox);
  check("aucun conflit", rt.store.conflicts.length === 0, rt.store.conflicts);
  const srv = await http<Any>("GET", `/projects/${pid}`, A.token);
  check("le serveur a le projet, l'étape et la tâche avec les mêmes identifiants", srv.status === 200 && srv.data.project.stages[0].id === stageId && srv.data.project.stages[0].tasks[0].id === taskId, srv.data);
  check("membre provisoire remplacé par le vrai membre", rt.model.project(pid)!.members.length === 1 && !rt.store.where("ProjectMember", (m) => m._provisional).length);
  const srvMap = await http<Any>("GET", `/mindmaps/${mapId}`, A.token);
  check("le serveur a la carte et le nœud", srvMap.status === 200 && srvMap.data.mindmap.nodes.some((n: Any) => n.id === node.id));

  // B rejoint le projet (relais en ligne de l'API locale).
  const add = await api("POST", `/projects/${pid}/members`, { userId: B.id });
  check("ajout d'équipe relayé au serveur", add.project.members.some((m: Any) => m.userId === B.id));

  console.log("\n3. Hors ligne : création, modifications fusionnées, commentaire, session, image collée");
  setForcedOffline(true);
  const off = await api("POST", "/tasks", { name: "Créée hors ligne", stageId });
  const offId = off.task.id as string;
  await api("PATCH", `/tasks/${offId}`, { priority: "CRITICAL" });
  await api("PATCH", `/tasks/${offId}`, { description: "détails hors ligne" });
  check("création + 2 modifications = 1 opération", rt.store.outbox.filter((o) => o.id === offId).length === 1 && rt.store.outbox.find((o) => o.id === offId)?.fields?.priority === "CRITICAL");
  const nameBase = rt.store.rec("Task", taskId)!.seqs;
  await api("PATCH", `/tasks/${taskId}`, { name: "Nom par l'appli", dueDate: "2026-12-24" });
  await api("PATCH", `/tasks/${taskId}`, { status: "IN_PROGRESS" });
  check("modifications de la tâche existante fusionnées", rt.store.outbox.filter((o) => o.id === taskId).length === 1);
  check("règles métier appliquées localement (en cours → 50 %)", rt.model.task(taskId)!.progress === 50 && rt.model.task(taskId)!.status === "IN_PROGRESS");
  void nameBase;
  const c = await api("POST", `/tasks/${taskId}/comments`, { body: "Commentaire hors ligne" });
  check("commentaire visible localement", c.task.comments.some((x: Any) => x.body === "Commentaire hors ligne"));
  const s = await api("POST", `/tasks/${taskId}/sessions`, { date: "2026-12-20" });
  check("session de travail locale", s.sessions.length === 1);
  const png = new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")], { type: "image/png" });
  const form = new FormData();
  form.append("file", png, "pixel.png");
  const up = await api("POST", "/uploads", form);
  check("image collée hors ligne → data: URL", String(up.url).startsWith("data:image/png;base64,"));
  await api("PATCH", `/notes/node/${node.id}`, { notes: `<p>Avec image</p><img src="${up.url}">` });
  const tmp = await api("POST", "/tasks", { name: "Éphémère" });
  await api("DELETE", `/tasks/${tmp.task.id}`);
  check("créée puis supprimée hors ligne : aucune opération", !rt.store.outbox.some((o) => o.id === tmp.task.id));
  await api("PATCH", `/projects/${pid}`, { description: "description par l'appli" });
  const dash = await api("GET", "/dashboard");
  check("tableau de bord local calculé hors ligne", dash.dashboard.myTasks.some((t: Any) => t.id === offId));
  const mine = await api("GET", "/me/tasks");
  check("« Mes tâches » local", mine.tasks.some((t: Any) => t.id === offId));
  const tree = await api("GET", `/notes/tree?parent=project:${pid}`);
  check("arborescence de notes locale", tree.children.some((i: Any) => i.ref === `stage:${stageId}`));
  const found = await api("GET", "/search?q=hors ligne");
  check("recherche locale", found.results.some((h: Any) => h.id === offId));
  let offlineErr: Any = null;
  try {
    await api("POST", `/projects/${pid}/deliverables`, { name: "Livrable" });
  } catch (e) {
    offlineErr = e;
  }
  check("action hors périmètre refusée hors ligne (503 OFFLINE)", offlineErr?.status === 503 && offlineErr?.code === "OFFLINE", offlineErr);
  await rt.sync.syncNow();
  check("hors ligne : rien n'est envoyé, statut hors ligne", rt.sync.status.online === false && rt.store.outbox.length > 0, rt.sync.status);

  console.log("\n4. Pendant ce temps, B modifie sur le web");
  const bName = await http("PATCH", `/tasks/${taskId}`, B.token, { name: "Nom par B (web)" });
  check("B renomme la tâche", bName.status === 200, bName);

  console.log("\n5. Retour du réseau : synchronisation");
  setForcedOffline(false);
  await rt.sync.syncNow();
  check("file vidée", rt.store.outbox.length === 0, rt.store.outbox);
  const conf = rt.store.conflicts.find((x) => x.entityId === taskId && x.field === "name");
  check("conflit sur le nom : la valeur du serveur l'emporte et est historisée", !!conf && conf.serverValue === "Nom par B (web)" && conf.localValue === "Nom par l'appli" && rt.model.task(taskId)!.name === "Nom par B (web)", rt.store.conflicts);
  const srvTask = (await http<Any>("GET", `/tasks/${taskId}`, A.token)).data.task;
  check("les autres champs sont passés (échéance, statut, commentaire, session)", String(srvTask.dueDate).startsWith("2026-12-24") && srvTask.status === "IN_PROGRESS" && srvTask.comments.some((x: Any) => x.body === "Commentaire hors ligne") && srvTask.workSessions.length === 1, srvTask);
  const srvOff = await http<Any>("GET", `/tasks/${offId}`, A.token);
  check("la tâche créée hors ligne existe sur le serveur, avec ses modifications", srvOff.status === 200 && srvOff.data.task.priority === "CRITICAL" && srvOff.data.task.description === "détails hors ligne", srvOff.data);
  const srvNode = (await http<Any>("GET", `/mindmaps/${mapId}`, A.token)).data.mindmap.nodes.find((n: Any) => n.id === node.id);
  check("image hors ligne téléversée et remplacée par /media/… (serveur et local)", /src="\/media\/[^"]+\.png"/.test(srvNode.notes) && /\/media\//.test(rt.store.get("MindNode", node.id)!.notes), srvNode.notes);
  const srvProj = (await http<Any>("GET", `/projects/${pid}`, A.token)).data.project;
  const loc = rt.model.project(pid)!;
  const shape = (p: Any) => ({
    name: p.name,
    description: p.description,
    progress: p.progress,
    stages: p.stages.map((st: Any) => ({ id: st.id, name: st.name, progress: st.progress, tasks: st.tasks.map((t: Any) => ({ id: t.id, name: t.name, status: t.status, progress: t.progress, order: t.order, priority: t.priority })) })),
    members: p.members.map((m: Any) => m.userId).sort(),
  });
  check("parité : le projet local est identique au projet serveur", JSON.stringify(shape(loc)) === JSON.stringify(shape(srvProj)), { local: shape(loc), server: shape(srvProj) });

  console.log("\n6. Suppression sur le serveur pendant une modification hors ligne");
  const victim = await api("POST", `/stages/${stageId}/tasks`, { name: "À supprimer par B" });
  await rt.sync.syncNow();
  setForcedOffline(true);
  await api("PATCH", `/tasks/${victim.task.id}`, { name: "modifiée hors ligne" });
  await http("DELETE", `/tasks/${victim.task.id}`, B.token);
  setForcedOffline(false);
  await rt.sync.syncNow();
  check("la suppression serveur l'emporte (objet retiré, conflit historisé)", !rt.store.get("Task", victim.task.id) && rt.store.conflicts.some((x) => x.entityId === victim.task.id && x.kind === "deleted-on-server"), rt.store.conflicts.slice(0, 3));

  console.log("\n7. Suppression hors ligne d'un objet modifié sur le serveur");
  const keep = await api("POST", `/stages/${stageId}/tasks`, { name: "À garder" });
  await rt.sync.syncNow();
  setForcedOffline(true);
  await api("DELETE", `/tasks/${keep.task.id}`);
  check("supprimée localement", !rt.store.get("Task", keep.task.id));
  await http("PATCH", `/tasks/${keep.task.id}`, B.token, { description: "modifiée par B" });
  setForcedOffline(false);
  await rt.sync.syncNow();
  check("suppression refusée : l'objet est restauré", rt.store.get("Task", keep.task.id)?.description === "modifiée par B" && rt.store.conflicts.some((x) => x.entityId === keep.task.id && x.kind === "delete-refused"), rt.store.conflicts.slice(0, 3));

  console.log("\n8. Changements du web récupérés et périmètre");
  const bProj = await http<Any>("POST", "/projects", B.token, { name: "Projet de B" });
  await http("POST", `/projects/${bProj.data.project.id}/members`, B.token, { userId: A.id });
  await rt.sync.syncNow();
  check("projet partagé par B reçu (instantané ciblé)", !!rt.model.project(bProj.data.project.id), rt.model.projects().map((p) => p.name));
  const bMember = (await http<Any>("GET", `/projects/${bProj.data.project.id}`, B.token)).data.project.members.find((m: Any) => m.userId === A.id);
  await http("DELETE", `/members/${bMember.id}`, B.token);
  await rt.sync.syncNow();
  check("retiré de l'équipe : projet purgé localement", !rt.model.project(bProj.data.project.id));
  check("statut : en ligne, à jour", rt.sync.status.online && rt.sync.status.pending === 0 && !rt.sync.status.lastError, rt.sync.status);

  console.log("\n9. Persistance : réouverture de la base locale");
  await rt.store.flush();
  const name = (rt.store as Any).db.name as string;
  const again = await createRuntime({ dbName: name, installTransport: false });
  check("données, curseur et conflits rechargés", again.store.get("Task", offId)?.name === "Créée hors ligne" && again.store.meta.cursor === rt.store.meta.cursor && again.store.conflicts.length === rt.store.conflicts.length);

  console.log("\n9 bis. Prérequis hors ligne");
  setForcedOffline(true);
  await api("PATCH", `/tasks/${offId}`, { prerequisiteIds: [taskId] });
  check("prérequis appliqué localement", JSON.stringify(rt.model.task(offId)!.prerequisiteIds) === JSON.stringify([taskId]), rt.model.task(offId));
  const cycle = await api("PATCH", `/tasks/${taskId}`, { prerequisiteIds: [offId] }).then(() => null, (e: Error) => e.message);
  check("cycle refusé localement (mêmes règles que le serveur)", !!cycle && /circulaire/i.test(cycle), cycle);
  setForcedOffline(false);
  await rt.sync.syncNow();
  const srvPrereq = await http<Any>("GET", `/tasks/${offId}`, A.token);
  check("prérequis synchronisé au serveur", JSON.stringify(srvPrereq.data.task?.prerequisiteIds) === JSON.stringify([taskId]), srvPrereq.data.task?.prerequisiteIds);

  console.log("\n9 ter. Parité avec le site");
  {
    // Projet créé hors ligne, tâche affectée à soi : la fiche membre garde son identifiant au serveur.
    setForcedOffline(true);
    const np = await api("POST", "/projects", { name: "Projet hors ligne" });
    const npId = np.project.id as string;
    const meMember = np.project.members[0].id as string;
    const nt = await api("POST", `/projects/${npId}/tasks`, { name: "À moi", assigneeId: meMember });
    // Déconnexion avec des modifications non envoyées : refusée (rien n'est effacé).
    const lo = await api("POST", "/auth/logout").then(() => null, (e: Any) => e);
    check("déconnexion refusée tant que des modifications attendent", lo?.code === "UNSYNCED_CHANGES" && rt.store.outbox.length > 0 && !!rt.store.meta.token, lo?.message);
    // Ordre personnel modifié hors ligne : mis en attente.
    await api("PUT", "/me/tasks/order", { taskIds: [nt.task.id, offId] });
    check("ordre personnel en attente hors ligne", JSON.stringify(rt.store.meta.pendingRanks) === JSON.stringify([nt.task.id, offId]));
    setForcedOffline(false);
    await rt.sync.syncNow();
    const srvNt = await http<Any>("GET", `/tasks/${nt.task.id}`, A.token);
    check("projet créé hors ligne : tâche affectée à soi acceptée par le serveur", srvNt.status === 200 && srvNt.data.task.assigneeId === meMember && !rt.store.conflicts.some((x) => x.entityId === nt.task.id), { task: srvNt.data.task?.assigneeId, meMember, conflicts: rt.store.conflicts.slice(-2) });
    const srvOrder = await http<Any>("GET", "/me/tasks/order", A.token);
    check("ordre personnel envoyé à la reconnexion", srvOrder.data.taskIds?.[0] === nt.task.id && rt.store.meta.pendingRanks === null, srvOrder.data);

    // Fichier de projet (multipart) depuis l'application.
    const doc = new FormData();
    doc.append("file", new Blob(["bonjour"], { type: "text/plain" }), "note.txt");
    const upDoc = await api("POST", `/projects/${npId}/documents`, doc).then((r: Any) => r, (e: Any) => e);
    const docs = await http<Any>("GET", `/projects/${npId}/documents`, A.token);
    check("document envoyé depuis l'application", !(upDoc instanceof Error) && docs.data.documents?.some((d: Any) => d.name === "note.txt"), upDoc?.message ?? docs.data);

    // Projet partagé à l'instant par B : ouvert depuis le serveur avant la synchro.
    const shared = await http<Any>("POST", "/projects", B.token, { name: "Partagé à l'instant" });
    const sid = shared.data.project.id as string;
    await http("POST", `/projects/${sid}/members`, B.token, { userId: A.id });
    const opened = await api("GET", `/projects/${sid}`).then((r: Any) => r, (e: Any) => e);
    check("projet pas encore synchronisé : ouvert depuis le serveur", opened?.project?.id === sid, opened?.message);
    // Tâche de B : A (simple membre) ne peut pas la sortir du projet.
    const bTask = await http<Any>("POST", `/projects/${sid}/tasks`, B.token, { name: "Tâche de B" });
    await rt.sync.syncNow();
    const detach = await api("PATCH", `/tasks/${bTask.data.task.id}`, { projectId: null }).then(() => null, (e: Any) => e);
    check("détacher la tâche d'autrui : refusé localement (403)", detach?.status === 403, detach?.message);
    // B commente : nom de l'auteur fourni par le serveur.
    await http("POST", `/tasks/${bTask.data.task.id}/comments`, B.token, { body: "Vu par B" });
    await rt.sync.syncNow();
    const cm = rt.store.where("TaskComment", (x) => x.body === "Vu par B")[0];
    const detail = await api("GET", `/tasks/${bTask.data.task.id}`);
    check("commentaire d'autrui : nom du compte joint par le serveur", cm?.authorName === "NativeB Test" && detail.task.comments.some((x: Any) => x.authorName === "NativeB Test"), cm);

    // Suppression d'une étape : ses tâches ne restent prérequises de personne.
    const st = await api("POST", `/projects/${npId}/stages`, { name: "Étape jetable" });
    const stId = st.project.stages[0].id as string;
    const inStage = await api("POST", `/stages/${stId}/tasks`, { name: "Dans l'étape" });
    await api("PATCH", `/tasks/${nt.task.id}`, { prerequisiteIds: [inStage.task.id] });
    await rt.sync.syncNow();
    await api("DELETE", `/stages/${stId}`);
    await rt.sync.syncNow();
    const after = await http<Any>("GET", `/tasks/${nt.task.id}`, A.token);
    check("étape supprimée : prérequis nettoyés (local et serveur)", rt.model.task(nt.task.id)!.prerequisiteIds.length === 0 && after.data.task.prerequisiteIds.length === 0, { local: rt.model.task(nt.task.id)!.prerequisiteIds, server: after.data.task.prerequisiteIds });

    await http("DELETE", `/projects/${npId}`, A.token);
    await http("DELETE", `/projects/${sid}`, B.token);
    await rt.sync.syncNow();
  }

  console.log("\n10. iPhone : URL des médias");
  const media = mediaRewriter(() => "https://sb.example");
  const dto = { notes: '<p><img src="/media/2026/a.png"></p>', avatarUrl: "/media/u/b.webp", other: "texte /media/ inchangé" };
  const abs = media.toAbsolute(dto);
  check("affichage : médias absolus", abs.notes.includes('src="https://sb.example/media/2026/a.png"') && abs.avatarUrl === "https://sb.example/media/u/b.webp" && abs.other === dto.other, abs);
  check("enregistrement : médias relatifs (aller-retour exact)", JSON.stringify(media.toRelative(abs)) === JSON.stringify(dto));
  check("sans serveur : inchangé", mediaRewriter(() => "").toAbsolute(dto) === dto);

  console.log("\n11. Nettoyage");
  await http("DELETE", `/projects/${pid}`, A.token);
  await http("DELETE", `/projects/${bProj.data.project.id}`, B.token);
  await http("DELETE", `/mindmaps/${mapId}`, A.token);
  rt.sync.stop();
  console.log(`\n${passes} vérification(s) réussie(s), ${failures} échec(s).`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
