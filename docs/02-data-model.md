# Modèle de données

Source : `prisma/schema.prisma`. Base PostgreSQL. Identifiants `cuid`.
Les relations enfant → parent sont en `onDelete: Cascade` ; les références
« facultatives » (responsable, livrable d'un document, étape d'un livrable)
sont en `SetNull`.

```
User ──< Session
User ──< MindMap ──< MindNode (arbre par parentId)
User ──< Project (owner)
Project ──< ProjectMember (userId? → User)
Project ──< Stage ──< Activity ──< Task
                 └──────────────< Task (activityId = null)
Task ──< TaskComment (author → User ; parentId → TaskComment : fil)
Task ──< WorkSession (user → User)         sessions de travail planifiées
Task ──< TaskRank (user → User)            ordre relatif personnel
Task ──< Notification (user → User)
Task.assigneeId → ProjectMember
Project ──< Deliverable (stageId? → Stage, assigneeId? → ProjectMember)
Project ──< Document (deliverableId? → Deliverable, uploadedById? → User)
```

## Comptes

| Modèle | Champs | Notes |
| --- | --- | --- |
| `User` | `id`, `email` (unique), `passwordHash`, `name`, timestamps | propriétaire des cartes et des projets, auteur des commentaires et dépôts |
| `Session` | `id`, `token` (unique, 256 bits), `userId`, `label?`, `expiresAt`, `createdAt` | jeton unique cookie **et** Bearer ; `label` = client (« Web », « iPhone ») |

## Cartes mentales

| Modèle | Champs | Notes |
| --- | --- | --- |
| `MindMap` | `id`, `ownerId`, `title`, timestamps | `title` = titre du nœud racine (synchronisés) |
| `MindNode` | `id`, `mapId`, `parentId?`, `title`, `notes` (HTML), `color?`, `collapsed`, `status` (`OPEN` · `WATCH` · `CLOSED`), `order`, timestamps | `parentId = null` ⇔ racine (une par carte) ; `order` renuméroté 0..n-1 parmi les frères ; `WATCH` = mis en évidence, `CLOSED` = hachuré et masqué par défaut avec sa descendance |

## Projets

| Modèle | Champs | Notes |
| --- | --- | --- |
| `Project` | `id`, `ownerId`, `name`, `description`, `color?`, `status` (`ACTIVE` · `ON_HOLD` · `DONE` · `ARCHIVED`), `startDate?`, `dueDate?`, timestamps | |
| `ProjectMember` | `id`, `projectId`, `userId?`, `name`, `email?`, `role?`, `color?`, `createdAt` | **équipe projet** : compte de l'application (`userId`) ou nom libre. `@@unique([projectId, userId])`. Le propriétaire est créé membre (« Chef de projet ») à la création du projet |
| `Stage` | `id`, `projectId`, `name`, `description`, `order`, `startDate?`, `dueDate?`, timestamps | étape |
| `Activity` | `id`, `stageId`, `name`, `description`, `order`, timestamps | niveau intermédiaire **facultatif** |
| `Task` | `id`, `stageId`, `activityId?`, `assigneeId?`, `name`, `description`, `status` (`TODO` · `IN_PROGRESS` · `DONE` · `CLOSED`), `progress` 0–100, `priority` (`LOW` · `MEDIUM` · `HIGH` · `CRITICAL`, défaut `MEDIUM`), `complexity` (`LOW` · `MEDIUM` · `HIGH`, défaut `MEDIUM`), `order`, `startDate?`, `dueDate?`, timestamps | `stageId` toujours renseigné, même sous une activité ; `assigneeId` → membre **du même projet** (vérifié). `CLOSED` = clôture **manuelle** après `DONE` (la tâche sort du flux courant) |
| `Folder` | `id`, `projectId`, `parentId?`, `name`, timestamps | arborescence documentaire (racine = `parentId` null) ; supprimer un dossier remonte ses documents et sous-dossiers dans le parent |
| `TaskComment` | `id`, `taskId`, `authorId`, `parentId?`, `body`, `mentions String[]`, timestamps | `parentId` → commentaire auquel on répond (fil de profondeur libre, `Cascade` : supprimer un commentaire supprime ses réponses) ; `body` contient des mentions `@[Nom](memberId)` ; `mentions` = ids de membres cités **et** appartenant au projet |
| `WorkSession` | `id`, `taskId`, `userId`, `date` (`DATE`), `createdAt` | jour où l'utilisateur prévoit de travailler sur la tâche ; `@@unique([taskId, userId, date])` ; « en retard » si `date > dueDate` (calculé) |
| `TaskRank` | `userId`, `taskId`, `rank` (`@@id([userId, taskId])`) | ordre relatif **personnel** des tâches (vue Synthèse), indépendant de `Task.order` |
| `Notification` | `id`, `userId`, `type` (`ASSIGNED` · `REPLY` · `TASK_UPDATED` · `MENTION`), `title`, `body`, `href`, `taskId?`, `projectId?`, `actorName?`, `readAt?`, `createdAt` | `readAt` null = non lue ; `TASK_UPDATED` regroupée (une non lue par tâche) ; jamais émise à l'auteur de l'action |
| `Deliverable` | `id`, `projectId`, `stageId?`, `assigneeId?`, `name`, `description`, `status` (`PLANNED` · `IN_PROGRESS` · `DELIVERED` · `VALIDATED`), `expectedStart?`, `expectedEnd?`, `deliveredAt?`, `order`, timestamps | `deliveredAt` posé automatiquement au passage à `DELIVERED`/`VALIDATED` (effacé en retour arrière) |
| `Document` | `id`, `projectId`, `folderId?`, `deliverableId?`, `uploadedById?`, `name`, `originalName`, `mimeType`, `size`, `storagePath`, `createdAt` | fichier sous `DATA_DIR/documents/<projectId>/<aléatoire>.<ext>` ; `folderId` = dossier de rangement (null = racine) ; `deliverableId` ⇒ le document **matérialise** ce livrable |

## Droits d'accès

- **Voir / modifier un projet** : propriétaire **ou** membre dont `userId`
  est le compte courant (`projectAccessWhere`).
- **Supprimer le projet, gérer l'équipe** : propriétaire uniquement.
- **Supprimer un document / un commentaire** : son auteur ou le propriétaire.
- Un membre « nom libre » (sans `userId`) ne voit rien : il sert à
  l'affectation et aux mentions (et ne reçoit pas de notification).
- **« Mes tâches »** (`isMyTask`) : affectées à un membre rattaché à mon
  compte, ou non affectées dans un projet dont je suis propriétaire.
- Sessions de travail et rangs : chacun ne voit / modifie que les siens
  (les sessions des autres membres sont visibles sur la fiche tâche).

## Invariants (`src/lib/projects.ts`, `tasks.ts`, `documents.ts`)

- `status ∈ {DONE, CLOSED} ⇒ progress = 100`, `status = TODO ⇔ progress = 0`
  (`reconcile()`). Passer `progress` à 100 donne `DONE` (ou laisse `CLOSED`) ;
  rabaisser l'avancement d'une tâche terminée ou clôturée la rouvre
  (`IN_PROGRESS`). `CLOSED` ne s'obtient que par une demande explicite.
- `DONE` et `CLOSED` comptent tous deux comme « terminées » dans les agrégats
  et sortent des échéances / tâches ouvertes.
- Les avancements des activités, étapes et projets ne sont **pas stockés** :
  agrégés à la lecture (`aggregate()` : moyenne, total, terminées).
- `order` renuméroté parmi les frères (étapes, activités, livrables ;
  tâches : par `stageId` + `activityId`).
- Affectations et rattachements (`assigneeId`, `stageId`, `deliverableId`)
  sont vérifiés comme appartenant au même projet.
- Toute mutation d'un projet ou d'une carte passe par une transaction qui
  verrouille la ligne parente (`SELECT … FOR UPDATE`).

## Migrations

`prisma/migrations/` est versionné :

| Migration | Contenu |
| --- | --- |
| `20261011000000_init` | comptes, sessions, cartes, projets/étapes/activités/tâches |
| `20261011204624_team_deliverables_documents_comments` | `ProjectMember`, `Deliverable`, `Document`, `TaskComment`, `Task.assigneeId/startDate` |
| `20261011210319_backfill_owner_members` | données : chaque propriétaire devient membre de ses projets existants |
| `20261011212245_folders_and_closed_status` | `Folder`, `Document.folderId`, valeur `CLOSED` de `TaskStatus` |
| `20261012200606_organizer_threads_notifications` | `MindNode.status`, `Task.priority/complexity`, `TaskComment.parentId`, `WorkSession`, `TaskRank`, `Notification` |
| `20261012201500_notification_task_updated` | renomme la valeur `COMMENT` → `TASK_UPDATED` de `NotificationType` (`ALTER TYPE … RENAME VALUE`) |

Développement : `npx prisma migrate dev`. Production : `npm run prod:deploy`
exécute `prisma migrate deploy` dans le conteneur `tools` **avant** de
démarrer la nouvelle version. Une migration de données s'écrit avec
`prisma migrate dev --create-only` puis en éditant le SQL généré.
