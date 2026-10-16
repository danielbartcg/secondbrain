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
    `415 UNSUPPORTED_MEDIA_TYPE`, `429 RATE_LIMITED`, `500 INTERNAL`
- Anti-CSRF : une requête mutante authentifiée **par cookie** doit porter un
  en-tête `Origin` égal à l'hôte (sans `Origin`, `Sec-Fetch-Site: cross-site`
  est refusé) et, si elle a un corps JSON, `Content-Type: application/json`
  (`415 UNSUPPORTED_MEDIA_TYPE` sinon). Les clients Bearer ne sont pas concernés.
- Quotas (`429 RATE_LIMITED`) : `POST /uploads` 120, `POST /projects/:id/documents`
  60, `POST /sync/push` 300 par utilisateur et 15 min ; `POST /auth/login`
  10 / 15 min par IP et par compte.
- Identifiants (`…Id`) : 64 caractères maximum.
- Dates : ISO 8601 en sortie ; en entrée, ISO ou `AAAA-MM-JJ` ; `null` efface.
- Couleurs : `#rrggbb` ou `null`.
- **Accès aux projets** : propriétaire ou membre rattaché à un compte. Les
  opérations marquées 👑 sont réservées au propriétaire (`403` sinon).

## Authentification

| Méthode | Route | Corps | Réponse |
| --- | --- | --- | --- |
| POST | `/auth/register` | `{ email, password (8 à 72 caractères), confirmPassword?, firstName?, lastName?, name?, client? }` (`confirmPassword` vérifiée si fournie) (au moins un des trois noms ; `name` seul = prénom) | `201 { user, token, expiresAt }` ; `409 EMAIL_TAKEN` (aussi pour l'e-mail du super administrateur, créé seulement par script) |
| POST | `/auth/login` | `{ email, password, client? }` | `{ user, token, expiresAt }` |
| POST | `/auth/logout` | — | `{ ok: true }` |
| GET | `/auth/me` | — | `{ user: { id, email, name, firstName, lastName, avatarUrl, theme, role, isAdmin, createdAt } }` |
| GET | `/me` | — | `{ profile: Profile }` |
| PATCH | `/me` | `{ firstName?, lastName?, avatarUrl? (/media/… ou null), theme?, emailNotifications? }` | `{ profile }` ; le nom affiché est recopié dans mes fiches membres |
| POST | `/me/password` | `{ currentPassword, newPassword (8 à 72 caractères, ≠ actuel), confirmPassword? }` | `{ ok: true }` ; `400 INVALID_CREDENTIALS` si l'actuel est faux ; `429` après 10 essais / 15 min ; ferme les **autres** sessions |
| GET | `/auth/options` | — | `{ registration, passwordReset }` (public) : `passwordReset` = envoi d'e-mails configuré et activé |
| POST | `/auth/forgot-password` | `{ email }` | `{ ok: true }` **même si le compte n'existe pas** ; `503 MAIL_DISABLED` si l'envoi n'est pas configuré ; 3 / h / adresse |
| POST | `/auth/reset-password` | `{ token, password, confirmPassword? }` | `{ ok: true }` ; ferme toutes les sessions ; `400 INVALID_TOKEN` (expiré, déjà utilisé) |
| POST | `/auth/verify-email` | `{ token }` | `{ email }` ; `400 INVALID_TOKEN` |
| POST | `/me/email` | `{ email, currentPassword }` | `{ email, verificationSent }` ; adresse non validée ensuite ; `400 BAD_PASSWORD`, `409 EMAIL_TAKEN` |
| POST | `/me/email/verification` | — | `{ ok, to }` (renvoi du lien) ; `409 ALREADY_VERIFIED`, `503 MAIL_DISABLED` |
| GET | `/me/pins` | — | `{ pins: { projects: { id, name, color }[], mindmaps: { id, title }[] } }` |
| PUT | `/me/pins` | `{ kind: "PROJECT"\|"MINDMAP", id, pinned: boolean }` | `{ pins }` ; `404` si l'élément n'est pas accessible |
| GET | `/me/api-keys` | — | `{ apiKeys: { id, name, prefix, canWrite, createdAt, lastUsedAt }[] }` |
| POST | `/me/api-keys` | `{ name, canWrite? (défaut true) }` | `201 { key, apiKey }` — `key` (`sb_…`) n'est renvoyée **qu'ici** ; 10 clés max |
| DELETE | `/me/api-keys/:id` | — | `{ ok: true }` (révocation immédiate) |
| GET | `/me/team` | — | `{ members: { id, name, email, avatarUrl }[], tasks: OverviewTask[] }` (mes N-1 directs) |

```ts
type Profile = { id; email; name /* « Prénom Nom » */; firstName; lastName; avatarUrl: string | null;
                 theme: "light"|"dark"|"sepia"|"ocean"|"forest"; role: "USER"|"ADMIN"; isAdmin; isSuperAdmin;
                 managerId: string | null; reportCount; emailVerified: boolean; emailNotifications: boolean; createdAt };
type OverviewTask = Task & { projectName; projectColor; stageName; ownerName; assigneeName; supervisorName;
                             contributorNames: string[]; peopleUserIds: string[] };
```

## Administration

Réservé aux administrateurs (`role = ADMIN`) et au super administrateur codé
en dur (`daniel.barral@outlook.com`) : `403 FORBIDDEN` sinon. Lecture seule sur
les projets et tâches des autres.

| Méthode | Route | Corps | Réponse |
| --- | --- | --- | --- |
| GET | `/admin/users` | — | `{ users: { id, email, name, avatarUrl, role, isAdmin, isSuperAdmin, managerId, reportIds, projectCount, emailVerified, createdAt }[] }` |
| GET | `/admin/notifications` | — | `{ settings: NotificationSettings }` |
| PATCH | `/admin/notifications` | `{ smtpHost?, smtpPort?, smtpSecure?, smtpUser?, smtpPassword? (absent = inchangé, "" = effacé), smtpFrom?, emailEnabled?, types?: { type, enabled, email }[] }` | `{ settings }` ; `400` si activation sans serveur ni expéditeur |
| POST | `/admin/notifications/test` | — | `{ ok, to }` : e-mail de test à l'administrateur ; `502 SMTP_ERROR` avec le message du serveur ; 10 / 15 min |
| PATCH | `/admin/users/:id` | `{ role?: "USER"\|"ADMIN", managerId?: string \| null }` | `{ users }` ; `400` : super administrateur, son propre rôle, boucle hiérarchique, soi-même comme manager |
| GET | `/admin/projects` | — | `{ projects: (ProjectSummary & { ownerName; ownerEmail; taskCount })[] }` |
| GET | `/admin/projects/:id` | — | `{ project: Project & { ownerName } }` |
| GET | `/admin/tasks` | — | `{ tasks: OverviewTask[] }` (5 000 max, plus récentes d'abord) |
| GET | `/users/lookup?email=` | — | `{ user: { id, name, email } \| null }` (e-mail exact ; 60 / 15 min) |

## Tableau de bord

| Méthode | Route | Réponse |
| --- | --- | --- |
| GET | `/dashboard?horizon=30` | `{ dashboard: DashboardDto }` |

```ts
type DashboardDto = {
  projects: ProjectSummary[];                 // tous mes projets (propriétaire ou membre)
  myTasks: (Task & { projectId; projectName; projectColor; stageName; assigneeName })[]; // mes tâches OUVERTES, par échéance, 100 max
  myOpenCount: number;                        // nombre exact de mes tâches ouvertes
  deadlines: { kind: "task" | "deliverable"; id; name; projectId; projectName; projectColor;
               dueDate; status; assigneeName; daysLeft; mine }[];   // sous `horizon` jours, retards inclus, plus urgentes d'abord, 100 max
  next7Count: number;                         // nombre exact d'échéances dans les 7 jours (tâches + livrables)
  statusCounts: { TODO; IN_PROGRESS; DONE };    // toutes les tâches des projets actifs
  myStatusCounts: { TODO; IN_PROGRESS; DONE };  // mes tâches
  deliverableCounts: { PLANNED; IN_PROGRESS; DELIVERED; VALIDATED };
  overdueCount: number;
  globalProgress: { percent; total; done };
};
```

## Cartes mentales

```ts
type MindNode = { id; parentId: string | null; title; notes /* HTML assaini */; color; collapsed;
                  status: "OPEN"|"WATCH"|"CLOSED"; order; x: number | null; y: number | null /* position manuelle */;
                  taskCount; openTaskCount; updatedAt };
type MapSharing = { access: "owner" | "write" | "read" /* mon droit */;
                    owner: { id; name; avatarUrl } | null /* qui me l'a partagée ; null = à moi */;
                    sharedWith: number /* nb de partages (vue propriétaire, 0 sinon) */ };
type MindMap  = { id; title; createdAt; updatedAt; rootId; nodes: MindNode[] } & MapSharing;
```

Accès : lecture (`GET`) pour le propriétaire et toute personne avec qui la
carte est partagée ; écriture (nœuds, titre, mise en page, notes, tâches
rattachées) pour le propriétaire et les partages `WRITE` (sinon **403
`READ_ONLY`**) ; suppression de la carte et gestion des partages :
propriétaire seulement (**403**). Carte non accessible : **404**.

| Méthode | Route | Corps | Réponse |
| --- | --- | --- | --- |
| GET | `/mindmaps` | — | `{ mindmaps: [{ id, title, nodeCount, createdAt, updatedAt, access, owner, sharedWith }] }` (mes cartes **et** celles partagées avec moi) |
| POST | `/mindmaps` | `{ title }` | `201 { mindmap }` |
| GET | `/mindmaps/:id` | — | `{ mindmap }` |
| PATCH | `/mindmaps/:id` | `{ title? }` | `{ mindmap }` |
| DELETE | `/mindmaps/:id` | — | `{ ok: true }` |
| POST | `/mindmaps/:id/nodes` | `{ parentId, title?, index? }` | `201 { node }` |
| PATCH | `/mindmaps/:id/nodes/:nodeId` | `{ title?, notes?, color?, collapsed?, status?, x?, y? }` (`x`/`y` null = position automatique) | `{ node }` |
| DELETE | `/mindmaps/:id/layout` | — | `{ mindmap }` « Affichage optimisé » : efface toutes les positions manuelles |
| DELETE | `/mindmaps/:id/nodes/:nodeId` | — | `{ ok: true }` |
| POST | `/mindmaps/:id/nodes/:nodeId/move` | `{ parentId, index? }` | `{ node }` |

### Partage d'une carte

```ts
type MapShare = { userId; name; email; avatarUrl; permission: "READ" | "WRITE"; createdAt };
```

| Méthode | Route | Corps | Réponse |
| --- | --- | --- | --- |
| GET | `/mindmaps/:id/shares` | — | `{ shares: MapShare[] }` (propriétaire seulement) |
| POST | `/mindmaps/:id/shares` | `{ userId }` **ou** `{ email }` (compte existant, adresse exacte), `permission?: "READ"\|"WRITE"` (défaut `READ`) | `201 { shares }` — crée ou met à jour le partage ; propriétaire seulement ; `400` soi-même, `404` compte inconnu ; 60 / 15 min / utilisateur (`429`) ; 200 personnes max par carte |
| PATCH | `/mindmaps/:id/shares/:userId` | `{ permission }` | `{ shares }` (propriétaire seulement) |
| DELETE | `/mindmaps/:id/shares/:userId` | — | propriétaire : retire l'accès → `{ shares }` ; `:userId` = moi : **quitter** la carte → `{ ok: true }` |

Le destinataire reçoit une notification `MAP_SHARED` (« Alice a partagé la
carte « X » avec vous (lecture | écriture) », lien `/mindmaps/:id`), aussi
lors d'un changement de droit ; jamais le propriétaire. Retirer un partage
(ou quitter) supprime l'épingle de la carte du destinataire. Choix du
destinataire côté client : `GET /messages/contacts` et `GET /users/lookup?email=`.

## Projets

```ts
type Progress = { percent; total; done };
type Member   = { id; userId: string | null; name; email; role; color; avatarUrl: string | null /* photo du compte */ };
type Task     = { id; ownerId; projectId: string | null; stageId: string | null; activityId: string | null;  // rattachement facultatif
                  assigneeId; supervisorId: string | null; contributorIds: string[]; prerequisiteIds: string[]; name; description; status: "TODO"|"IN_PROGRESS"|"DONE"|"CLOSED";
                  progress: 0..100; priority: "LOW"|"MEDIUM"|"HIGH"|"CRITICAL"; complexity: "LOW"|"MEDIUM"|"HIGH";
                  order; startDate; dueDate; closedAt: string | null /* date de clôture */; commentCount; hasNotes; nodeIds: string[] /* nœuds de carte */; updatedAt };
type TaskMutation = { project: Project | null; task: Task | null };   // réponse des mutations de tâche
type Activity = { id; stageId; name; description; hasNotes; order; progress; tasks: Task[] };
type Stage    = { id; projectId; name; description; hasNotes; order; startDate; dueDate; progress; activities: Activity[]; tasks: Task[] };
type Folder   = { id; parentId: string | null; name };     // arborescence documentaire (null = racine)
type Document = { id; folderId: string | null; deliverableId; name; originalName; mimeType; size;
                  uploadedBy: {id,name}|null; createdAt; url: "/api/v1/documents/:id/download" };
type Deliverable = { id; stageId; assigneeId; name; description; status: "PLANNED"|"IN_PROGRESS"|"DELIVERED"|"VALIDATED";
                     expectedStart; expectedEnd; deliveredAt; order; documents: Document[] };
type ProjectSummary = { id; ownerId; name; description; color; status; startDate; dueDate; progress;
                        stageCount; memberCount; deliverableCount; createdAt; updatedAt };
type Project = ProjectSummary & { notes /* HTML assaini */; stages: Stage[]; tasks: Task[] /* sans étape */; members: Member[]; deliverables: Deliverable[]; documents: Document[]; folders: Folder[] };
```

Toute mutation sur un projet ou l'un de ses éléments **renvoie le projet
complet recalculé** (`{ project }`).

| Méthode | Route | Corps |
| --- | --- | --- |
| GET | `/projects` | → `{ projects: ProjectSummary[] }` |
| POST | `/projects` | `{ name, description?, color?, status?, startDate?, dueDate? }` (le créateur devient membre « Chef de projet ») |
| GET | `/projects/:id` | → `{ project }` |
| PATCH | `/projects/:id` | champs du POST, optionnels ; `customFields?: { fieldId: valeur \| null }` (fusion ; liste : id d'option ou libellé exact ; texte ≤ 500 ; 400 si champ inconnu, archivé ou valeur hors liste) |
| GET | `/custom-fields` | — | `{ fields: { id, label, type, options: { id, label }[], order, active }[] }` (actifs) |
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
| GET | `/tasks` | → `{ tasks: Task[] }` mes tâches **sans projet** |
| POST | `/tasks` | corps de tâche + `projectId?, stageId?, activityId?, nodeId?` → `201 TaskMutation` (rien = tâche sans projet ; `nodeId` = rattachée à ce nœud) |
| POST | `/projects/:id/tasks` | tâche du projet **sans étape** → `201 TaskMutation` |
| POST | `/stages/:id/tasks` | tâche directement sous l'étape → `201 TaskMutation` |
| POST | `/activities/:id/tasks` | tâche sous une activité → `201 TaskMutation` |
| GET | `/tasks/:id` | → `{ task: TaskDetail }` (voir fiche tâche) |
| PATCH | `/tasks/:id` | `{ name?, description?, status?, progress?, priority?, complexity?, startDate?, dueDate?, closedAt?, assigneeId?, supervisorId?, contributorIds?, prerequisiteIds?, order?, projectId?, stageId?, activityId? }` → `TaskMutation` |
| DELETE | `/tasks/:id` | → `{ project: Project \| null, task: null }` |

Corps d'une tâche à la création : `{ name, description?, status?, progress?, priority?, complexity?, startDate?, dueDate?, assigneeId?, supervisorId?, contributorIds?, prerequisiteIds? }`

`prerequisiteIds` **remplace** la liste des prérequis : tâches du même projet,
ni la tâche elle-même ni une dépendance circulaire (`400` sinon) ; une tâche
sans projet n'en a pas ; un changement de projet les efface (et retire la
tâche des prérequis des autres).
(priorité et complexité par défaut `MEDIUM`).
`assigneeId` (responsable) et `supervisorId` (superviseur, un seul) doivent
être des membres du projet (`400` sinon ; `null` désaffecte) ;
`contributorIds` **remplace** la liste des contributeurs (membres du projet,
dédoublonnés). Impossible sur une tâche sans projet ; un changement de projet
remet responsable, superviseur et contributeurs à zéro. Les membres à compte
nouvellement impliqués reçoivent une notification `ASSIGNED`.

**Rattachement** (`PATCH`) : le niveau le plus précis l'emporte et déduit les
niveaux supérieurs — `activityId` (id) ⇒ étape et projet ; `stageId` (id) ⇒
projet, activité effacée si l'étape change ; `projectId` (id) ⇒ sans étape ni
activité si le projet change ; `null` détache le niveau et ceux du dessous
(`projectId: null` ⇒ tâche sans projet). Changer de projet retire
l'affectation (sauf `assigneeId` valide fourni). Les tâches accessibles sont
celles de mes projets **et** mes tâches sans projet.

Cohérence statut / avancement : `progress = 100 ⇒ DONE` (une tâche `CLOSED`
le reste), `progress = 0 ⇒ TODO`, sinon `IN_PROGRESS` ; `status = DONE` ou
`CLOSED ⇒ 100`, `TODO ⇒ 0`, `IN_PROGRESS` sans avancement cohérent ⇒ 50.
`closedAt` est posée automatiquement au passage à `CLOSED`, effacée à la
réouverture, et modifiable (`PATCH { closedAt }`) uniquement sur une tâche
clôturée. `CLOSED` (clôture) est une action **manuelle** : `PATCH { status: "CLOSED" }`,
proposée dans l'interface une fois la tâche terminée ; `PATCH { status: "DONE" }`
la rouvre.

### Fiche tâche et commentaires

```ts
type TaskComment = { id; parentId: string | null; authorId; authorName; authorAvatarUrl: string | null; body; mentions: string[]; createdAt };
type WorkSession = { id; date: "AAAA-MM-JJ"; userId; userName; mine: boolean; late: boolean /* après l'échéance */ };
type TaskDetail  = Task & {
  project: { id; name; color; ownerId; members: Member[] };
  stage: { id; name }; activity: { id; name } | null; assignee: Member | null;
  comments: TaskComment[];        // liste plate ; le client reconstruit le fil par parentId
  workSessions: WorkSession[];    // toutes les sessions de la tâche (tous membres)
  nodes: { id; title; mapId; mapTitle }[];
  notes: string;                  // HTML assaini (« Prise de notes »)
  canEdit: boolean;               // false en consultation (administrateur, manager d'un N-1) : lecture seule
};
```

| Méthode | Route | Corps | Réponse |
| --- | --- | --- | --- |
| GET | `/tasks/:id` | — | `{ task }` |
| POST | `/tasks/:id/comments` | `{ body, parentId? }` (`parentId` = commentaire de la même tâche auquel on répond ; `400` sinon) | `201 { task }` |
| DELETE | `/comments/:id` | — | `{ task }` (auteur ou propriétaire ; supprime aussi les réponses) |
| POST | `/tasks/:id/sessions` | `{ date: "AAAA-MM-JJ" }` (idempotent pour un même jour) | `201 { sessions: WorkSession[] }` |
| DELETE | `/sessions/:id` | — | `{ sessions }` (ses propres sessions uniquement) |

Mentions : le client envoie la forme lisible `@[Nom]` (ce que l'utilisateur
voit dans la zone de saisie) ; le serveur la résout par nom (insensible à la
casse) en `@[Nom](memberId)` et ne retient dans `mentions` que les membres du
projet. La forme complète `@[Nom](memberId)` est aussi acceptée en entrée
(identifiant vérifié). Un `@[Nom]` sans membre correspondant reste du texte.

#### Tâches d'un nœud de carte mentale

```ts
type NodeTasks = { nodeId; tasks: (Task & { projectName; projectColor })[]; taskCount; openTaskCount /* non clôturées */ };
```

| Méthode | Route | Corps | Réponse |
| --- | --- | --- | --- |
| GET | `/mindmaps/:id/nodes/:nodeId/tasks` | — | `NodeTasks` |
| POST | `/mindmaps/:id/nodes/:nodeId/tasks` | `{ taskId }` (tâche accessible, carte modifiable ; idempotent) | `201 NodeTasks` |
| DELETE | `/mindmaps/:id/nodes/:nodeId/tasks/:taskId` | — | `NodeTasks` (la tâche subsiste) |

`MindNode` expose aussi `taskCount` et `openTaskCount`. Créer une tâche depuis
un nœud : `POST /tasks { name, nodeId }`. Lister : droit de lecture sur la
carte (seules les tâches qui me sont accessibles sont listées) ; rattacher,
détacher, créer avec `nodeId` : droit d'écriture.

## Téléchargements (public)

| Méthode | Route | Réponse |
| --- | --- | --- |
| GET | `/downloads/SecondBrain-Setup-<x.y.z>.exe` (hors `/api`) | installateur Windows publié (`attachment`) ; nom strictement contrôlé, 404 sinon |

La page publique `/app` lit `DATA_DIR/downloads/latest.json` (`version`,
`file`, `size`, `sha256`, `publishedAt`).

## Synchronisation hors ligne (applications)

Réservé aux applications desktop / iPhone (le web reste en ligne). En-tête
**`X-Sync-Protocol: 2`** obligatoire : sinon `426 UPGRADE_REQUIRED` (« mettez
l'application à jour »), `details.serverVersion` donne la version attendue.

| Méthode | Route | Réponse |
| --- | --- | --- |
| GET | `/sync/pull` (sans curseur) | **instantané** du périmètre : `{ protocol, cursor, hasMore: false, snapshot: true, scope, changes }` |
| GET | `/sync/pull?cursor=N[&limit=1000]` | changements depuis `N` (pages ; reboucler tant que `hasMore`) |
| GET | `/sync/pull?project=<id>` ou `?map=<id>` | instantané d'un élément entré dans le périmètre (`cursor: null` : ne pas toucher au curseur) |
| POST | `/sync/push` | `{ ops: Op[] }` (500 max, rejouées dans l'ordre) → `{ protocol, results: OpResult[] }` |

```ts
type Change  = { entity; id; op: "upsert" | "delete"; data?: Row /* colonnes, dates ISO */; seqs?: { [champ]: seq; "*": seq } };
type Scope   = { projectIds: string[]; mapIds: string[] };  // purger localement ce qui n'y figure plus
type Op      = { opId /* unique, [A-Za-z0-9_-]{8,80} */; entity; id /* généré par le client, cuid */;
                 op: "create" | "update" | "delete"; fields?: Row; base?: { [champ]: seq; "*"?: seq } };
type OpResult = { opId; status: "applied" | "conflict" | "rejected"; conflicts?: { field; serverValue }[];
                  deleted?: boolean; error?: { code; message }; data?: Row; seqs?: { … } /* état après l'opération */ };
```

Entités : `MindMap` (create `{ title, rootId? }`), `MindNode` (`{ mapId, parentId, title, order?, notes, color, collapsed, status, x, y }` ;
changer `parentId` = déplacer), `MindNodeTask` (id `nodeId:taskId`, create / delete), `Project`, `Stage`, `Activity`, `Task`
(mêmes champs que l'API REST, plus `notes`), `TaskContributor` (id `taskId:memberId`, create / delete), `WorkSession`
(`{ taskId, date }`), `TaskComment` (`{ taskId, body, parentId? }`, pas de modification). Lecture seule :
`ProjectMember`, `Deliverable`, `Document` (sans chemin de stockage), `Folder`, `MindMapShare` (id `mapId:userId` ;
le propriétaire reçoit tous les partages de sa carte, un destinataire seulement le sien). Les lignes `MindMap`
portent en plus `ownerName` et `ownerAvatarUrl`, les `ProjectMember` `userName` et `userAvatarUrl`, les `TaskComment`
`authorName` et `authorAvatarUrl` (dérivés, non versionnés). `Project` create accepte `ownerMemberId` (identifiant
imposé de la fiche membre du créateur, projet créé hors ligne). Le périmètre `mapIds` comprend les
cartes partagées avec moi ; une écriture sur une carte en lecture seule est `rejected` (403 `READ_ONLY`).

Règles :
- **Mise à jour** : chaque champ est appliqué si sa version serveur ≤ `base[champ]`
  (à défaut `base["*"]`) ; sinon il est refusé (`conflicts`, valeur serveur
  conservée) et les autres champs passent. Objet supprimé ou devenu
  inaccessible : `conflict` + `deleted: true` (la suppression gagne).
- **Suppression** : refusée (`conflict`) si l'objet a été modifié après
  `base["*"]` ; un objet déjà supprimé → `applied`.
- **Création** : identifiant fourni par le client ; s'il existe déjà et vous
  appartient → `applied` (renvoi), sinon `409 ID_TAKEN` (`rejected`).
- `rejected` : validation, accès refusé, objet parent introuvable — le client
  abandonne l'opération et se resynchronise.
- Le client **fusionne** ses opérations en attente sur un même objet (création
  + modifications = une création) et utilise les `seqs` renvoyées comme
  nouvelles versions de base.

## Prise de notes

```ts
type NoteRef  = "root" | `section:${"mindmaps"|"projects"|"orphans"}` | `mindmap:${id}` | `node:${id}` | `project:${id}` | `stage:${id}` | `activity:${id}` | `task:${id}`;
type TreeItem = { ref; kind; id; title; hint?; color?; hasChildren; hasNotes };
type NoteDocument = { ref; kind; id; title; breadcrumb: { ref; title }[]; href: string | null; notes /* HTML assaini */; editable; updatedAt };
```

| Méthode | Route | Réponse |
| --- | --- | --- |
| GET | `/notes/tree?parent=<NoteRef>` (défaut `root`) | `{ parent, children: TreeItem[] }` — enfants **directs** seulement (chargement paresseux) |
| GET | `/notes/:kind/:id` | `{ document: NoteDocument }` |
| PATCH | `/notes/:kind/:id` | `{ notes }` (HTML ≤ 500 ko, assaini) → `{ document }` ; `400` sur une section |

`mindmap:<id>` lit et écrit les notes du **nœud racine** de la carte (un
`node:<id>` racine est redirigé vers sa carte). Accès : cartes du compte et
cartes partagées avec moi (`editable: false` et `PATCH` → 403 en lecture
seule), projets accessibles, tâches accessibles (y compris sans projet).

## Recherche

| Méthode | Route | Réponse |
| --- | --- | --- |
| GET | `/search?q=…&kinds=project,task,node,mindmap&limit=6` | `{ results: { kind; id; title; subtitle; href; status?; color? }[] }` |

`q` : 2 caractères minimum ; `contains` insensible à la casse sur nom / titre
et description / notes ; `limit` par type (20 max) ; `href` = page dédiée
(`/tasks/:id`, `/projects/:id`, `/mindmaps/:id?node=:nodeId`, `/mindmaps/:id`).

## Organisation personnelle (« mes tâches »)

« Mes tâches » = celles dont je suis responsable, superviseur ou
contributeur (membre rattaché à mon compte), **ou** non affectées dans un
projet dont je suis propriétaire, **ou** mes tâches sans projet (`projectId: null`, `projectName: "Sans projet"`). Projets actifs / en pause.

```ts
type OrganizerTask = Task & { projectId; projectName; projectColor; stageName; activityName; assigneeName;
                              roles: { assigned; supervising; contributing; owner };  // pourquoi « à moi »
                              rank: number | null;                     // ordre relatif personnel
                              sessions: { id; date; late }[] };        // mes sessions de travail
```

| Méthode | Route | Corps | Réponse |
| --- | --- | --- | --- |
| GET | `/me/tasks` | — | `{ tasks: OrganizerTask[] }` triées par rang, puis échéance, puis priorité |
| GET | `/me/tasks/order` | — | `{ taskIds: string[] }` : mon ordre relatif (tâches accessibles), utilisé par l'application |
| PUT | `/me/tasks/order` | `{ taskIds: string[] }` (ordre voulu ; ids inaccessibles ignorés) | `{ ok: true }` |

```ts
type NotificationSettings = { smtpHost; smtpPort; smtpSecure; smtpUser; smtpPasswordSet: boolean /* jamais le mot de passe */; smtpFrom;
  emailEnabled; types: { type; enabled; email }[]; stats: { sent; failed; pending; lastError: string | null } /* 7 jours */ };
```

## Messagerie

```ts
type Participant = { id; name; avatarUrl; lastReadAt: string | null };
type Message = { id; authorId; authorName; authorAvatarUrl; body /* HTML assaini, "" si supprimé */; deleted; createdAt;
                 replyTo: { id; authorName; excerpt; deleted } | null };
type ConversationSummary = { id; title; participants: Participant[]; lastMessageAt; unreadCount;
                             lastMessage: { authorName; excerpt; deleted; createdAt; mine } | null };
```

| Méthode | Route | Corps | Réponse |
| --- | --- | --- | --- |
| GET | `/messages/conversations` | — | `{ conversations: ConversationSummary[] }` (200 max, plus récentes d'abord) |
| POST | `/messages/conversations` | `{ participantIds (1 à 50), title?, body? }` | `201 { conversationId, created: true }` ; à deux sans titre, conversation existante reprise : `200 { …, created: false }` |
| GET | `/messages/conversations/:id[?before=<messageId>\|?since=<ISO>]` | — | `{ conversation: { id, title, participants, messages, hasMore, serverTime } }` ; 50 derniers messages, `before` = page précédente, `since` = créés **ou supprimés** depuis ; 404 si non participant |
| DELETE | `/messages/conversations/:id` | — | `{ ok: true }` : quitter |
| POST | `/messages/conversations/:id/messages` | `{ body (HTML), replyToId? }` | `201 { message }` ; écrire vaut lecture ; notifie (`MESSAGE`) les autres ; 300 / 15 min |
| DELETE | `/messages/conversations/:id/messages/:messageId` | — | `{ message }` (auteur seulement, `403` sinon) |
| POST | `/messages/conversations/:id/read` | `{ read: boolean }` | `{ lastReadAt }` ; lu = notifications MESSAGE de la conversation lues ; non lu = depuis le dernier message reçu |
| GET | `/messages/unread` | — | `{ count }` |
| GET | `/messages/contacts` | — | `{ contacts: { id, name, email, avatarUrl }[] }` |

## Connecteur MCP

`POST /api/v1/mcp` — JSON-RPC 2.0 (MCP « Streamable HTTP » sans état,
réponses `application/json`, lots acceptés, notifications → `202`).
`Authorization: Bearer sb_…` (clé d'accès, pas un jeton de session) ;
`401` sinon ; `403` si `Origin` étranger ; `GET` → `405`. Méthodes :
`initialize`, `ping`, `tools/list`, `tools/call` (`resources/list` et
`prompts/list` vides). Outils de lecture, et d'écriture si la clé a
`canWrite` (voir docs/01 : `create_task`, `update_task`, `bulk_update_tasks`,
`update_meeting`…, `api_reference`, `api_request` vers toute route de ce
document sauf auth, clés, mot de passe, e-mail, sync, mcp) ; une erreur
métier revient en résultat d'outil `isError: true`. Paramètre
`admin_access: true` (administrateurs) sur `list_projects`, `get_project`,
`list_tasks`, `get_task`.

## Notifications

```ts
type Notification = { id; type: "ASSIGNED"|"REPLY"|"TASK_UPDATED"|"MENTION"|"MESSAGE"; title; body; href;
                      taskId; projectId; actorName; read: boolean; createdAt };
```

| Méthode | Route | Corps | Réponse |
| --- | --- | --- | --- |
| GET | `/notifications?limit=30&unread=1` | — | `{ notifications, unreadCount }` (récentes d'abord, 100 max) |
| PATCH | `/notifications/:id` | `{ read: boolean }` | `{ notification }` |
| POST | `/notifications/read-all` | — | `{ ok: true }` |
| DELETE | `/notifications/:id` | — | `{ ok: true }` |

Émission : `ASSIGNED` (tâche créée / ré-affectée à un membre à compte),
`TASK_UPDATED` (tâche affectée modifiée ou commentée ; une seule non lue par
tâche, rafraîchie), `REPLY` (réponse à mon commentaire), `MENTION`,
`MESSAGE` (une seule non lue par conversation). Types désactivés dans
Administration → Notifications : jamais créés. Copie e-mail selon la
plateforme, le type et la préférence du destinataire (docs/01). L'auteur
de l'action n'est jamais notifié. `href` pointe vers la fiche tâche,
éventuellement `#comment-<id>`.

## Livrables

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

## Historique d'une tâche

| Méthode | Route | Réponse |
| --- | --- | --- |
| GET | `/mindmaps/:id/history?nodeId=&limit=` | `{ events: { id, kind, nodeId, nodeTitle, oldValue, newValue, message, actorId, actorName, actorAvatarUrl, createdAt }[] }` (plus récent d'abord, 300 par défaut, 1000 max ; lecture de la carte, 404 sinon) |
| GET | `/activity?period=&from=&to=&projectId=&mapId=&all=1` | `{ activity: ActivityReport }` — `period` ∈ today, yesterday, 7d, week, last_week, 30d, month, last_month, quarter (défaut 7d) ou `from` / `to` (AAAA-MM-JJ inclus, jours de Paris, 366 j max ; 400 sinon) ; `all=1` administrateurs (403 sinon). `ActivityReport = { from, to, label, scope, totals, people, days: { day, tasks, maps, other }[], projects: { id, name, color, createdInPeriod, total, counts, tasks: { id, name, status, deleted, stageName, events, eventCount }[], stagesCreated, meetings, risks, deliverables, documents }[], maps: { id, title, total, counts, events, nodes }[], truncated }` ; outils MCP `get_activity` (mêmes paramètres, `project_id`, `map_id`, `admin_access`) et `get_map_history` |
| GET | `/tasks/:id/history` | `{ events: { id, kind, field, oldValue, newValue, message, actorId, actorName, actorAvatarUrl, createdAt }[] }` (plus récent d'abord, 300 max ; mêmes droits que la fiche, 404 sinon) |

## Réunions

```ts
type Meeting = { id; projectId; title; date /* ISO */; location; authorId; authorName; minutes /* HTML assaini */; minutesUpdatedAt;
  participants: { memberId; name; userId; avatarUrl }[];
  approvers: { memberId; userId; name; avatarUrl; decision: "PENDING"|"APPROVED"|"REJECTED"; comment; decidedAt }[];
  status: "draft"|"no_review"|"pending"|"approved"|"rejected"; canEdit; myDecision: "PENDING"|"APPROVED"|"REJECTED"|null; createdAt; updatedAt };
```

Toutes les réponses : `{ meetings: Meeting[] }` (liste du projet, plus récentes d'abord).

| Méthode | Route | Corps | Notes |
| --- | --- | --- | --- |
| GET | `/projects/:id/meetings` | — | membres du projet (404 sinon) |
| POST | `/projects/:id/meetings` | `{ title (1–200), date (ISO), location?, participantIds?, approverIds?, minutes? }` | 201 ; validateurs = membres rattachés à un compte (400 sinon) |
| PATCH | `/meetings/:meetingId` | mêmes champs, facultatifs | rédacteur ou propriétaire (403 sinon) ; modifier `minutes` remet toutes les décisions à `PENDING` et notifie les validateurs |
| DELETE | `/meetings/:meetingId` | — | rédacteur ou propriétaire |
| POST | `/meetings/:meetingId/decision` | `{ decision: "APPROVED"\|"REJECTED", comment }` | validateur uniquement (403) ; motif obligatoire pour un refus (400) ; compte-rendu vide : 400 ; notifie le rédacteur |

## Risques et opportunités

```ts
type Risk = { id; projectId; kind: "RISK"|"OPPORTUNITY"; title; description; category; probability /* 1–5 */; impact /* 1–5 */;
  score /* p × i */; level: "low"|"medium"|"high"|"critical"; levelLabel; status: "OPEN"|"MONITORING"|"TREATED"|"CLOSED";
  ownerId; ownerName; response; strategy: "ACCEPT"|"MITIGATE"|"TRANSFER"|"ELIMINATE"|null; order; taskIds; tasks: { id; name; status }[]; createdAt; updatedAt };
```

Réponses : `{ risks: Risk[] }` (liste complète du projet, triée par `order` puis création).

| Méthode | Route | Corps | Notes |
| --- | --- | --- | --- |
| GET | `/projects/:id/risks` | — | membre, propriétaire ou administrateur (lecture) |
| POST | `/projects/:id/risks` | `{ title, kind?, description?, category?, probability?, impact?, status?, ownerId?, response?, strategy? }` | 201 ; responsable = membre du projet |
| PATCH | `/risks/:riskId` | mêmes champs + `order?` | `strategy: null` efface ; `strategy` ∈ `ACCEPT` · `MITIGATE` · `TRANSFER` · `ELIMINATE` |
| DELETE | `/risks/:riskId` | — | trace sur les tâches liées |
| PUT | `/risks/:riskId/tasks` | `{ taskIds (≤ 500) }` | remplace les tâches liées (même projet, 400 sinon) ; tracé dans l'historique des tâches |

## Export Excel

| Méthode | Route | Réponse |
| --- | --- | --- |
| GET | `/projects/:id/export` | classeur `.xlsx` (`attachment`) : Synthèse (avec champs personnalisés), Tâches, Planning (Gantt), Étapes & activités, Livrables, Risques & opportunités, Matrices, Réunions, Équipe, Documents ; membres du projet (404 sinon) ; 30 / 15 min |

## Administration (compléments)

| Méthode | Route | Corps | Réponse |
| --- | --- | --- | --- |
| GET | `/admin/custom-fields` | — | `{ fields (archivés compris), usage: { fieldId: nb de projets } }` |
| POST | `/admin/custom-fields` | `{ label, type: "TEXT"\|"LIST", options?: { label }[] }` | `201 { fields }` ; 50 champs, 500 valeurs max ; doublons refusés |
| PATCH | `/admin/custom-fields/:id` | `{ label?, active?, options?: { id?, label }[] (liste complète), order? }` | `{ fields }` ; valeurs retirées effacées des projets |
| DELETE | `/admin/custom-fields/:id` | — | `{ fields }` ; valeurs effacées de tous les projets |
| GET | `/admin/settings` | — | `{ registration: { enabled, forcedClosed, open } }` |
| PATCH | `/admin/settings` | `{ registrationEnabled }` | idem ; ferme / ouvre les inscriptions libres |
| POST | `/admin/users` | `{ email, firstName, lastName, password (8–72), role?, managerId? }` | 201 `{ users }` ; 409 `EMAIL_TAKEN` (y compris l'adresse du super administrateur) ; 404 manager ; 429 (30 / h / administrateur) ; adresse non validée |
| POST | `/admin/users/:id/password` | `{ password }` | `{ ok: true }` ; ferme toutes les sessions de la personne ; 403 sur le super administrateur (sauf lui-même) |

`/auth/options` → `registration` reflète ce réglage ; `/auth/register` répond 403
`REGISTRATION_CLOSED` quand elles sont fermées.

## Téléchargements (compléments)

`GET /downloads/latest.json` (public, `no-cache`) : `{ platform, version, file, size, sha256, publishedAt }` de la dernière version desktop (404 si aucune) ; lu par l'updater de l'application.
