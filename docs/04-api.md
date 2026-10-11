# API REST `/api/v1`

Contrat consommé par le client web et, demain, par l'application mobile.

## Conventions

- JSON partout (`Content-Type: application/json`), sauf les téléversements
  (multipart) et les téléchargements (binaire).
- **Authentification** : jeton de session opaque, obtenu par `login` /
  `register`.
  - Web : posé automatiquement en cookie HTTP-only `session`.
  - Mobile : conserver `token` et l'envoyer en `Authorization: Bearer <token>`
    (prioritaire sur le cookie). Durée de vie : 90 jours.
- **Erreurs** : `{ "error": { "code", "message", "details?" } }`
  - `400 BAD_REQUEST` / `400 VALIDATION` (`details` = `zod.flatten()`)
  - `401 UNAUTHENTICATED`, `401 INVALID_CREDENTIALS`
  - `403 FORBIDDEN` (réservé au propriétaire), `403 CSRF`, `403 REGISTRATION_CLOSED`
  - `404 NOT_FOUND`, `409 EMAIL_TAKEN`, `413 TOO_LARGE`, `415 UNSUPPORTED_TYPE`,
    `429 RATE_LIMITED`, `500 INTERNAL`
- Anti-CSRF : une requête mutante authentifiée **par cookie** doit porter un
  en-tête `Origin` égal à l'hôte. Les clients Bearer ne sont pas concernés.
- Dates : ISO 8601 en sortie ; en entrée, ISO ou `AAAA-MM-JJ` ; `null` efface.
- Couleurs : `#rrggbb` ou `null`.
- **Accès aux projets** : propriétaire ou membre rattaché à un compte. Les
  opérations marquées 👑 sont réservées au propriétaire (`403` sinon).

## Authentification

| Méthode | Route | Corps | Réponse |
| --- | --- | --- | --- |
| POST | `/auth/register` | `{ email, password (≥ 8), name, client? }` | `201 { user, token, expiresAt }` |
| POST | `/auth/login` | `{ email, password, client? }` | `{ user, token, expiresAt }` |
| POST | `/auth/logout` | — | `{ ok: true }` |
| GET | `/auth/me` | — | `{ user: { id, email, name, createdAt } }` |
| GET | `/users/lookup?email=` | — | `{ user: { id, name, email } \| null }` (e-mail exact ; 60 / 15 min) |

## Tableau de bord

| Méthode | Route | Réponse |
| --- | --- | --- |
| GET | `/dashboard?horizon=30` | `{ dashboard: DashboardDto }` |

```ts
type DashboardDto = {
  projects: ProjectSummary[];                 // tous mes projets (propriétaire ou membre)
  myTasks: (Task & { projectId; projectName; projectColor; stageName; assigneeName })[];
  deadlines: { kind: "task" | "deliverable"; id; name; projectId; projectName; projectColor;
               dueDate; status; assigneeName; daysLeft; mine }[];   // sous `horizon` jours, retards inclus
  statusCounts: { TODO; IN_PROGRESS; DONE };    // toutes les tâches des projets actifs
  myStatusCounts: { TODO; IN_PROGRESS; DONE };  // mes tâches
  deliverableCounts: { PLANNED; IN_PROGRESS; DELIVERED; VALIDATED };
  overdueCount: number;
  globalProgress: { percent; total; done };
};
```

## Cartes mentales

```ts
type MindNode = { id; parentId: string | null; title; notes /* HTML assaini */; color; collapsed; order; updatedAt };
type MindMap  = { id; title; createdAt; updatedAt; rootId; nodes: MindNode[] };
```

| Méthode | Route | Corps | Réponse |
| --- | --- | --- | --- |
| GET | `/mindmaps` | — | `{ mindmaps: [{ id, title, nodeCount, createdAt, updatedAt }] }` |
| POST | `/mindmaps` | `{ title }` | `201 { mindmap }` |
| GET | `/mindmaps/:id` | — | `{ mindmap }` |
| PATCH | `/mindmaps/:id` | `{ title? }` | `{ mindmap }` |
| DELETE | `/mindmaps/:id` | — | `{ ok: true }` |
| POST | `/mindmaps/:id/nodes` | `{ parentId, title?, index? }` | `201 { node }` |
| PATCH | `/mindmaps/:id/nodes/:nodeId` | `{ title?, notes?, color?, collapsed? }` | `{ node }` |
| DELETE | `/mindmaps/:id/nodes/:nodeId` | — | `{ ok: true }` |
| POST | `/mindmaps/:id/nodes/:nodeId/move` | `{ parentId, index? }` | `{ node }` |

## Projets

```ts
type Progress = { percent; total; done };
type Member   = { id; userId: string | null; name; email; role; color };
type Task     = { id; stageId; activityId; assigneeId; name; description; status: "TODO"|"IN_PROGRESS"|"DONE"|"CLOSED";
                  progress: 0..100; order; startDate; dueDate; commentCount; updatedAt };
type Activity = { id; stageId; name; description; order; progress; tasks: Task[] };
type Stage    = { id; projectId; name; description; order; startDate; dueDate; progress; activities: Activity[]; tasks: Task[] };
type Folder   = { id; parentId: string | null; name };     // arborescence documentaire (null = racine)
type Document = { id; folderId: string | null; deliverableId; name; originalName; mimeType; size;
                  uploadedBy: {id,name}|null; createdAt; url: "/api/v1/documents/:id/download" };
type Deliverable = { id; stageId; assigneeId; name; description; status: "PLANNED"|"IN_PROGRESS"|"DELIVERED"|"VALIDATED";
                     expectedStart; expectedEnd; deliveredAt; order; documents: Document[] };
type ProjectSummary = { id; ownerId; name; description; color; status; startDate; dueDate; progress;
                        stageCount; memberCount; deliverableCount; createdAt; updatedAt };
type Project = ProjectSummary & { stages: Stage[]; members: Member[]; deliverables: Deliverable[]; documents: Document[]; folders: Folder[] };
```

Toute mutation sur un projet ou l'un de ses éléments **renvoie le projet
complet recalculé** (`{ project }`).

| Méthode | Route | Corps |
| --- | --- | --- |
| GET | `/projects` | → `{ projects: ProjectSummary[] }` |
| POST | `/projects` | `{ name, description?, color?, status?, startDate?, dueDate? }` (le créateur devient membre « Chef de projet ») |
| GET | `/projects/:id` | → `{ project }` |
| PATCH | `/projects/:id` | champs du POST, optionnels |
| DELETE 👑 | `/projects/:id` | → `{ ok: true }` |

### Équipe

| Méthode | Route | Corps |
| --- | --- | --- |
| POST 👑 | `/projects/:id/members` | `{ userId }` (compte) **ou** `{ name, email?, role?, color? }` (nom libre) |
| PATCH 👑 | `/members/:id` | `{ name?, email?, role?, color? }` |
| DELETE 👑 | `/members/:id` | retire le membre (tâches/livrables désaffectés) ; le propriétaire ne peut pas être retiré |

### Étapes, activités, tâches

| Méthode | Route | Corps |
| --- | --- | --- |
| POST | `/projects/:id/stages` | `{ name, description?, startDate?, dueDate? }` |
| PATCH | `/stages/:id` | `{ name?, description?, startDate?, dueDate?, order? }` |
| DELETE | `/stages/:id` | |
| POST | `/stages/:id/activities` | `{ name, description? }` |
| PATCH | `/activities/:id` | `{ name?, description?, order? }` |
| DELETE | `/activities/:id` | |
| POST | `/stages/:id/tasks` | tâche directement sous l'étape |
| POST | `/activities/:id/tasks` | tâche sous une activité |
| GET | `/tasks/:id` | → `{ task: TaskDetail }` (voir fiche tâche) |
| PATCH | `/tasks/:id` | `{ name?, description?, status?, progress?, startDate?, dueDate?, assigneeId?, order?, activityId?, stageId? }` |
| DELETE | `/tasks/:id` | |

Corps d'une tâche à la création : `{ name, description?, status?, progress?, startDate?, dueDate?, assigneeId? }`.
`assigneeId` doit être un membre du projet (`400` sinon ; `null` désaffecte).

Cohérence statut / avancement : `progress = 100 ⇒ DONE` (une tâche `CLOSED`
le reste), `progress = 0 ⇒ TODO`, sinon `IN_PROGRESS` ; `status = DONE` ou
`CLOSED ⇒ 100`, `TODO ⇒ 0`, `IN_PROGRESS` sans avancement cohérent ⇒ 50.
`CLOSED` (clôture) est une action **manuelle** : `PATCH { status: "CLOSED" }`,
proposée dans l'interface une fois la tâche terminée ; `PATCH { status: "DONE" }`
la rouvre.

### Fiche tâche et commentaires

```ts
type TaskComment = { id; authorId; authorName; body; mentions: string[]; createdAt };
type TaskDetail  = Task & {
  project: { id; name; color; ownerId; members: Member[] };
  stage: { id; name }; activity: { id; name } | null; assignee: Member | null;
  comments: TaskComment[];
};
```

| Méthode | Route | Corps | Réponse |
| --- | --- | --- | --- |
| GET | `/tasks/:id` | — | `{ task }` |
| POST | `/tasks/:id/comments` | `{ body }` | `201 { task }` |
| DELETE | `/comments/:id` | — | `{ task }` (auteur ou propriétaire) |

Mentions : le client envoie la forme lisible `@[Nom]` (ce que l'utilisateur
voit dans la zone de saisie) ; le serveur la résout par nom (insensible à la
casse) en `@[Nom](memberId)` et ne retient dans `mentions` que les membres du
projet. La forme complète `@[Nom](memberId)` est aussi acceptée en entrée
(identifiant vérifié). Un `@[Nom]` sans membre correspondant reste du texte.

### Livrables

| Méthode | Route | Corps |
| --- | --- | --- |
| POST | `/projects/:id/deliverables` | `{ name, description?, status?, stageId?, assigneeId?, expectedStart?, expectedEnd?, deliveredAt? }` |
| PATCH | `/deliverables/:id` | mêmes champs, optionnels, + `order?` |
| DELETE | `/deliverables/:id` | les documents rattachés restent dans le projet |

Passage à `DELIVERED` / `VALIDATED` sans `deliveredAt` ⇒ horodaté ; retour
à `PLANNED` / `IN_PROGRESS` ⇒ `deliveredAt = null`.

### Dossiers et documents

| Méthode | Route | Corps | Réponse |
| --- | --- | --- | --- |
| POST | `/projects/:id/folders` | `{ name, parentId? }` (`null`/absent = racine) | `201 { project }` |
| PATCH | `/folders/:id` | `{ name?, parentId? }` (`null` = racine ; refus si cible dans sa propre arborescence) | `{ project }` |
| DELETE | `/folders/:id` | — | `{ project }` (documents et sous-dossiers remontent dans le parent) |
| GET | `/projects/:id/documents` | — | `{ documents }` |
| POST | `/projects/:id/documents` | `multipart/form-data` : `file`, `name?`, `deliverableId?`, `folderId?` | `201 { project }` |
| PATCH | `/documents/:id` | `{ name?, deliverableId?, folderId? }` (`null` détache / remet à la racine) | `{ project }` |
| DELETE | `/documents/:id` | — | `{ project }` (auteur du dépôt ou propriétaire) |
| GET | `/documents/:id/download[?inline=1]` | — | fichier (`Content-Disposition` attachment / inline) ; authentifié |

Types acceptés : PDF, images (JPEG/PNG/GIF/WebP), texte/CSV/Markdown/JSON,
zip, Office (doc/x, xls/x, ppt/x) et OpenDocument. 25 Mo max. Pas de SVG.

## Uploads d'images (notes)

| Méthode | Route | Corps | Réponse |
| --- | --- | --- | --- |
| POST | `/uploads` | `multipart/form-data`, `file` (JPEG/PNG/GIF/WebP ≤ 10 Mo) | `201 { url: "/media/AAAA/MM/<aléatoire>.ext" }` |
| GET | `/media/…` (hors `/api`) | — | image, cache immuable (URL non devinable, sans authentification) |
