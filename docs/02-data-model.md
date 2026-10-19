# Modèle de données

Source : `prisma/schema.prisma`. Base PostgreSQL. Identifiants `cuid`.
Les relations enfant → parent sont en `onDelete: Cascade` ; les références
« facultatives » (responsable, livrable d'un document, étape d'un livrable)
sont en `SetNull`.

```
User ──< Session
User ──< MindMap ──< MindNode (arbre par parentId)
MindMap ──< MindMapShare >── User           partage d'une carte (lecture / écriture)
User ──< Project (owner)
User ──< Task (owner : créateur ; seul lecteur d'une tâche sans projet)
Project ──< ProjectMember (userId? → User)
Project ──< Stage ──< Activity ──< Task
                 └──────────────< Task (activityId = null)
Project ──< Task (stageId = null : tâche du projet sans étape)
Task (projectId = null) : tâche « sans projet »
MindNode ──< MindNodeTask >── Task     rattachement n-n tâches ↔ nœuds
Task ──< TaskComment (author → User ; parentId → TaskComment : fil)
Task ──< WorkSession (user → User)         sessions de travail planifiées
Task ──< TaskRank (user → User)            ordre relatif personnel
Task ──< Notification (user → User)
Task.assigneeId → ProjectMember (responsable) ; Task.supervisorId → ProjectMember (superviseur)
Task ──< TaskContributor >── ProjectMember   contributeurs (n-n)
Project ──< Deliverable (stageId? → Stage, assigneeId? → ProjectMember)
Project ──< Document (deliverableId? → Deliverable, uploadedById? → User)
User ──< EmailToken                         liens à usage unique (validation, mot de passe oublié)
User ──< ApiKey                             clés d'accès personnelles (connecteur MCP)
Conversation ──< ConversationParticipant >── User   (lastReadAt : vu / non vu)
Conversation ──< Message (author? → User ; replyToId? → Message : réponse citée)
AppSettings (une ligne « global »)          SMTP, e-mails, notifications activées
User ──< Pin (kind PROJECT|MINDMAP, targetId)  épingles du menu de gauche
Task.prerequisiteIds[] → Task (même projet)  prérequis (Gantt)
Project ──< ProjectBaseline (createdBy? → User)  plannings de référence (Gantt)
User ──< ResurfaceCard (ref « kind:id »)      résurgence (boîtes de Leitner)
User ──o CalendarFeed                          flux iCal personnel (un au plus)
```

## Comptes

| Modèle | Champs | Notes |
| --- | --- | --- |
| `User` | `id`, `email` (unique), `passwordHash`, `name` (affiché, = « Prénom Nom »), `firstName`, `lastName`, `avatarUrl?`, `theme` (`light` · `dark` · `sepia` · `ocean` · `forest`), `role` (`USER` · `ADMIN`), `managerId?` (N+1, `SetNull`), `emailVerifiedAt?` (adresse validée, informatif), `emailNotifications` (copies e-mail, vrai par défaut), `staleDays` (fraîcheur : jours sans activité avant « endormi », 14 par défaut, 1–365), timestamps | propriétaire des cartes et des projets, auteur des commentaires et dépôts ; `reports` = N-1 directs ; super administrateur codé en dur (e-mail) |
| `EmailToken` | `id`, `userId`, `kind` (`VERIFY_EMAIL` · `RESET_PASSWORD`), `tokenHash` (unique, SHA-256), `email` (adresse visée), `expiresAt` (7 j / 1 h), `usedAt?`, `createdAt` | lien envoyé par e-mail, **à usage unique** (consommation atomique) ; un nouveau lien invalide les précédents du même usage ; une validation n'est acceptée que si `email` est toujours l'adresse du compte |
| `ApiKey` | `id`, `userId`, `name`, `prefix` (10 premiers caractères, affichage), `tokenHash` (unique, SHA-256), `canWrite` (défaut true), `lastUsedAt?`, `createdAt` | clé `sb_…` (256 bits) du connecteur MCP, montrée une seule fois ; lecture seule si `canWrite` faux, ne vaut pas session (refusée par `/api/v1` hors `/mcp`) ; 10 par compte |
| `Session` | `id`, `token` (unique : **empreinte SHA-256 hex** du jeton de 256 bits), `userId`, `label?`, `expiresAt`, `createdAt` | jeton unique cookie **et** Bearer, jamais stocké en clair (`hashSessionToken()`) ; `label` = client (« Web », « iPhone ») |

## Cartes mentales

| Modèle | Champs | Notes |
| --- | --- | --- |
| `MindMap` | `id`, `ownerId`, `title`, `isTemplate` (carte type), timestamps | `title` = titre du nœud racine (synchronisés) |
| `MindNode` | `id`, `mapId`, `parentId?`, `title`, `notes` (HTML), `color?`, `collapsed`, `status` (`OPEN` · `WATCH` · `CLOSED`), `order`, `x?`, `y?` (position manuelle sur le canevas ; null = automatique), timestamps | `parentId = null` ⇔ racine (une par carte) ; `order` renuméroté 0..n-1 parmi les frères ; `WATCH` = mis en évidence, `CLOSED` = hachuré et masqué par défaut avec sa descendance |
| `MindMapShare` | `mapId` + `userId` (clé), `permission` (`MapPermission` : `READ` · `WRITE`), `sharedById?` (`SetNull`), timestamps | partage d'une carte avec un autre compte ; jamais le propriétaire ; géré par le propriétaire seul (`src/lib/map-shares.ts`) ; le destinataire peut le supprimer (quitter) ; supprimé avec la carte ou le compte ; synchronisé en lecture seule |

**Droits sur une carte** (`src/lib/map-access.ts`, `requireMapAccess`) :
`owner` (propriétaire : tout, dont supprimer la carte et gérer les partages),
`write` (partage `WRITE` : nœuds, notes, titre, mise en page, tâches
rattachées), `read` (partage `READ` : consultation seule). Carte inaccessible
⇒ 404 ; droit insuffisant ⇒ 403. Lister / lire : `mapAccessWhere(userId)` ;
écrire : `mapWriteWhere(userId)` ou `requireMapAccess(…, "write")`.

## Projets

| Modèle | Champs | Notes |
| --- | --- | --- |
| `Project` | `id`, `ownerId`, `name`, `description`, `notes` (HTML, « Prise de notes »), `color?`, `status` (`ACTIVE` · `ON_HOLD` · `DONE` · `ARCHIVED`), `startDate?`, `dueDate?`, `customFields` (JSON `{ fieldId: texte | id d'option }`, défaut `{}`), `isTemplate` (projet type : hors périmètres, administrateurs ; migration `20261016170000_templates`), timestamps | |
| `CustomField` | `id`, `label`, `type` (`TEXT` · `LIST`), `options` (JSON `[{ id, label }]`), `optionSort` (`MANUAL` · `ASC` · `DESC`, enum `CustomOptionSort`), `order`, `active`, timestamps | champ personnalisé des projets, global (administration) ; migrations `20261016150000_custom_fields`, `20261019090000_custom_field_option_sort`. Tri forcé (`ASC` / `DESC`) : `options` est rangé à chaque enregistrement (`sortOptions`, collation française, nombres naturels) — l'ordre stocké est toujours l'ordre affiché |
| `ProjectMember` | `id`, `projectId`, `userId?`, `name`, `email?`, `role?`, `color?`, `createdAt` | **équipe projet** : compte de l'application (`userId`) ou nom libre. `@@unique([projectId, userId])`. Le propriétaire est créé membre (« Chef de projet ») à la création du projet |
| `Stage` | `id`, `projectId`, `name`, `description`, `notes` (HTML), `order`, `startDate?`, `dueDate?`, timestamps | étape |
| `Activity` | `id`, `stageId`, `name`, `description`, `notes` (HTML), `order`, timestamps | niveau intermédiaire **facultatif** |
| `Task` | `id`, `ownerId`, `projectId?`, `stageId?`, `activityId?`, `assigneeId?`, `supervisorId?`, `name`, `description`, `notes` (HTML), `status` (`TODO` · `IN_PROGRESS` · `DONE` · `CLOSED`), `progress` 0–100, `priority` (`LOW` · `MEDIUM` · `HIGH` · `CRITICAL`, défaut `MEDIUM`), `complexity` (`LOW` · `MEDIUM` · `HIGH`, défaut `MEDIUM`), `order`, `startDate?`, `dueDate?`, `closedAt?` (date de clôture), `prerequisiteIds[]` (tâches prérequises), timestamps | **prérequis** : tâches du **même projet**, sans cycle ni soi-même (`src/lib/shared/prerequisites.ts`) ; retirés des listes des autres tâches quand la tâche est supprimée ou change de projet (`array_remove`) ; colonne synchronisée comme les autres champs. **Rattachement facultatif et cohérent** : `activityId ⇒ stageId ⇒ projectId` ; `projectId = null` = sans projet (visible par `ownerId` seul) ; `assigneeId` → membre **du même projet** (vérifié ; impossible sans projet). `CLOSED` = clôture **manuelle** après `DONE` (la tâche sort du flux courant) |
| `TaskContributor` | `taskId`, `memberId`, `createdAt` (`@@id([taskId, memberId])`) | contributeurs d'une tâche (membres du même projet ; cascade à la suppression du membre) |
| `MindNodeTask` | `nodeId`, `taskId`, `createdAt` (`@@id([nodeId, taskId])`) | tâche rattachée à un nœud de carte ; le nœud compte ses tâches non clôturées |
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
- `closedAt` : posée à la clôture (`CLOSED`), effacée à la réouverture,
  modifiable seulement tant que la tâche est clôturée (`400` sinon, et `400`
  si l'on tente de la vider sur une tâche clôturée).
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

## Notifications, e-mails et paramètres

| Modèle | Champs | Notes |
| --- | --- | --- |
| `Notification` | … , `emailState?` (`PENDING` · `SENDING` · `SENT` · `FAILED`), `emailError?` | `emailState` null = pas de copie e-mail ; posé à `PENDING` par `notify()` si la plateforme, le type et le destinataire l'autorisent ; l'envoyeur (`mailer.ts`) le fait passer à `SENT` / `FAILED` |
| `AppSettings` | `id` = `"global"`, `smtpHost`, `smtpPort`, `smtpSecure`, `smtpUser`, `smtpPasswordEnc` (AES-256-GCM, clé dérivée de `SESSION_SECRET`), `smtpFrom`, `emailEnabled`, `disabledTypes[]`, `emailDisabledTypes[]` (`NotificationType`), `updatedAt` | créée à la première lecture ; un type désactivé n'est plus créé du tout |

Types de notification (`NotificationType`) : `ASSIGNED`, `TASK_UPDATED`,
`REPLY`, `MENTION`, `MESSAGE`.

## Piste d'audit, risques, réunions

| Modèle | Champs | Notes |
| --- | --- | --- |
| `TaskEvent` | `id`, `taskId` (cascade), `actorId?` (`SetNull`), `actorName`, `kind` (created · field · assignee · supervisor · contributors · prerequisites · attachment · comment · session · node · risk), `field?`, `oldValue?`, `newValue?`, `message`, `createdAt` | message lisible figé ; écrit dans la transaction de la modification ; index `createdAt` (rapport d'activité) |
| `MapEvent` | `id`, `mapId` (cascade), `nodeId?` (sans clé étrangère), `nodeTitle?` (figé), `actorId?` (`SetNull`), `actorName`, `kind` (created · renamed · node_created · node_renamed · node_notes · node_status · node_color · node_moved · node_deleted · task_linked · task_unlinked · shared · share_changed · unshared · left · layout_reset), `oldValue?`, `newValue?`, `message`, `createdAt` | piste d'audit des cartes (migrations `20261016140000_map_events`, `20261016141000_task_event_created_idx`) |
| `Risk` | `id`, `projectId`, `kind` (`RISK` · `OPPORTUNITY`), `title`, `description`, `category`, `probability` 1–5, `impact` 1–5, `status` (`OPEN` · `MONITORING` · `TREATED` · `CLOSED`), `ownerId?` → ProjectMember, `response`, `strategy?` (`ACCEPT` · `MITIGATE` · `TRANSFER` · `ELIMINATE`), `order`, timestamps | criticité = p × i (≤ 4 faible, ≤ 9 modéré, ≤ 15 élevé, sinon critique). Stratégie (enum `RiskStrategy`) libellée selon la nature : risque « Accepter et surveiller · Atténuer · Transférer · Éliminer », opportunité « Accepter et surveiller · Améliorer · Partager · Exploiter » (`STRATEGY_LABEL`, `src/lib/shared/risks.ts`). Pas de date d'échéance (colonne supprimée par la migration `20261016120000_risk_strategy`) |
| `RiskTask` | `riskId` + `taskId` (clé, cascades) | tâche du même projet |
| `Meeting` | `id`, `projectId`, `title`, `date`, `location`, `authorId?` (rédacteur, `SetNull`), `minutes` (HTML assaini), `minutesUpdatedAt?`, timestamps | |
| `MeetingParticipant` | `meetingId` + `memberId` | |
| `MeetingApprover` | `meetingId` + `memberId`, `decision` (`PENDING` · `APPROVED` · `REJECTED`), `comment`, `decidedAt?` | remis à `PENDING` à chaque modification du compte-rendu |

Non synchronisés (en ligne uniquement dans l'application native).
`AppSettings.registrationEnabled` : inscriptions libres.

## Second cerveau (non synchronisés)

| Modèle | Champs | Notes |
| --- | --- | --- |
| `ProjectBaseline` | `id`, `projectId` (cascade), `name`, `createdById?` (`SetNull`), `createdByName` (figé), `data` (JSON `{ stages: [{ id, name, startDate, dueDate }], tasks: [{ id, name, stageId, startDate, dueDate }] }`, dates AAAA-MM-JJ), `taskCount` (tâches datées), `createdAt` | planning de référence figé ; 20 par projet ; supprimable par son auteur ou le propriétaire ; index `(projectId, createdAt)` |
| `ResurfaceCard` | `userId` + `ref` (clé ; « kind:id » de Prise de notes), `box` 1–5, `dueAt`, `lastReviewedAt?`, `archived`, `createdAt` | créée à la première réponse ; supprimée si la note devient inaccessible ou vide ; index `(userId, dueAt)` |
| `CalendarFeed` | `userId` (clé), `tokenHash` (unique, SHA-256 du jeton `cal_…`), `createdAt`, `lastUsedAt?` (mis à jour au plus une fois par heure) | régénérer remplace l'empreinte (l'ancienne adresse cesse) ; supprimé avec le compte |

| `JournalEntry` | `userId`, `day` (`DATE`, jour de Paris), `block` (enum `JournalBlock` : SUMMARY · POSITIVE · NEGATIVE · ACHIEVEMENTS · REGRETS · HABITS · IMPROVEMENT), `content` (HTML assaini), timestamps | unique (`userId`, `day`, `block`) ; cascade sur l'utilisateur ; le bloc « Activité » n'est pas stocké ; migration `20261019120000_journal_risk_history` |
| `RiskSnapshot` | `id` (uuid posé par le déclencheur), `riskId` (sans clé étrangère : survit à la suppression), `projectId` (cascade), `deleted`, `data` (JSON = ligne `Risk`), `createdAt` (UTC) | écrit **uniquement** par le déclencheur `sb_risk_snapshot` (insert / update / delete sur `Risk` ; rien lors de la suppression en cascade d'un projet) ; voyage dans le temps |

`User.journalBlocks` (`String[]`, défaut : les 8 blocs) : blocs affichés du
journal quotidien, normalisés dans l'ordre canonique.

Les **liens `[[…]]`** n'ont pas de table : ils sont dans le HTML des notes
(`data-ref`, voir docs/01). La **fraîcheur** et le **voyage dans le temps**
sont calculés à la lecture (pistes d'audit, `updatedAt`).

## Types de projet personnels

| Modèle | Champs | Notes |
| --- | --- | --- |
| `ProjectType` | `id`, `userId`, `name` (unique par utilisateur, casse ignorée — contrôlé par le code), `order`, timestamps | cascade sur l'utilisateur ; 50 par utilisateur ; migration `20261019180000_project_types` |
| `ProjectTypeLink` | `userId` + `projectId` (clé), `typeId` | un type par projet et par utilisateur ; cascade sur l'utilisateur, le projet et le type (supprimer un type ⇒ ses projets redeviennent sans type) ; non synchronisé |

## Épingles du menu

| Modèle | Champs | Notes |
| --- | --- | --- |
| `Pin` | `userId` + `kind` (`PROJECT` · `MINDMAP`) + `targetId` (clé), `createdAt` | projet accessible ou carte accessible — possédée ou partagée (vérifié à l'épinglage ; supprimée quand le partage est retiré ou quitté) ; épingles orphelines ignorées et purgées à la lecture ; 30 max par utilisateur (la plus ancienne cède) ; non synchronisé |

## Messagerie

| Modèle | Champs | Notes |
| --- | --- | --- |
| `Conversation` | `id`, `title` (vide = noms des participants), `createdById?`, `createdAt`, `lastMessageAt` | à deux et sans titre : une seule conversation par paire (reprise) |
| `ConversationParticipant` | `conversationId` + `userId` (clé), `lastReadAt?`, `joinedAt` | **vu / non vu** : non lu = message d'un autre, non supprimé, postérieur à `lastReadAt` ; quitter = supprimer la ligne (la dernière personne supprime la conversation) |
| `Message` | `id`, `conversationId`, `authorId?` (`SetNull`), `body` (HTML assaini), `replyToId?` (`SetNull`, même conversation), `createdAt`, `updatedAt`, `deletedAt?` | suppression par l'auteur = contenu effacé, place conservée (« Message supprimé ») ; `updatedAt` sert au rafraîchissement `since` |

## Synchronisation (applications hors ligne)

| Modèle | Champs | Notes |
| --- | --- | --- |
| `SyncLog` | `seq` (BIGSERIAL), `entity`, `entityId`, `field?`, `op` (`UPSERT` · `DELETE`), `projectId?`, `mapId?`, `ownerId?`, `at` | alimenté **uniquement par le déclencheur** `sb_sync_log` sur MindMap, MindNode, MindNodeTask, MindMapShare, Project, ProjectMember, Stage, Activity, Task, TaskContributor, WorkSession, TaskComment, Deliverable, Document, Folder. `field` null = création / suppression ; `updatedAt` / `createdAt` ignorés. `entityId` composite « nodeId:taskId » (MindNodeTask) et « taskId:memberId » (TaskContributor), « mapId:userId » (MindMapShare, portée = sa carte). Une tâche qui change de projet produit une suppression pour l'ancienne portée. |
| `AppliedOp` | `userId`, `opId` (clé composite), `result` (JSON), `createdAt` | opérations déjà rejouées : un renvoi renvoie le même résultat sans réappliquer |

Version d'un champ = `max(seq)` de ses lignes `UPSERT` (ou de la création).

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
| `20261013120000_node_positions` | `MindNode.x` / `y` (position manuelle) |
| `20261015090000_notifications_email_messaging` | `EmailState`, valeur `MESSAGE` de `NotificationType`, `Notification.emailState/emailError`, `AppSettings`, `Conversation`, `ConversationParticipant`, `Message` |
| `20261015110000_email_tokens_api_keys` | `User.emailVerifiedAt` / `emailNotifications`, `EmailToken` (`EmailTokenKind`), `ApiKey` |
| `20261015140000_pins_task_prerequisites` | `Task.prerequisiteIds` (`TEXT[]`), `Pin` (`PinKind`) |
| `20261015200000_audit_risks_meetings` | `TaskEvent` ; `Risk` (`RiskKind`, `RiskStatus`), `RiskTask` ; `Meeting`, `MeetingParticipant`, `MeetingApprover` (`ApprovalDecision`) ; valeurs `MEETING_REVIEW` / `MEETING_DECISION` de `NotificationType` ; `AppSettings.registrationEnabled` |
| `20261015100000_session_token_hash` | données : `Session.token` remplacé par son empreinte SHA-256 (les sessions existantes restent valides) |
| `20261014220000_sync_log` | `SyncLog`, `AppliedOp`, fonction `sb_sync_log()` et déclencheurs sur les 14 tables synchronisées |
| `20261014190000_task_closed_at` | `Task.closedAt` (reprise : `updatedAt` des tâches déjà clôturées) |
| `20261014150000_users_profile_roles` | `User.firstName` (reprise : ancien `name`), `lastName`, `avatarUrl`, `theme`, `role` (`UserRole`), `managerId` |
| `20261014090000_task_supervisor_contributors` | `Task.supervisorId`, `TaskContributor` |
| `20261013150000_object_notes` | `notes` (HTML) sur `Project`, `Stage`, `Activity`, `Task` |
| `20261016090000_map_shares_api_key_write` | `MindMapShare` (`MapPermission`), valeur `MAP_SHARED` de `NotificationType` (et droit d'écriture des clés d'API) |
| `20261016091000_map_share_sync_trigger` | `sb_sync_log()` redéfinie avec la branche `MindMapShare` (identifiant « mapId:userId », portée `mapId`) et déclencheur sur `MindMapShare` |
| `20261018090000_baselines_resurface_calendar` | `User.staleDays`, `ProjectBaseline`, `ResurfaceCard`, `CalendarFeed` |
| `20261013080000_orphan_tasks_node_links` | `Task.ownerId` / `projectId` (reprise : projet déduit de l'étape, propriétaire du projet), `Task.stageId` nullable, `MindNodeTask` |

Développement : `npx prisma migrate dev`. Production : `npm run prod:deploy`
exécute `prisma migrate deploy` dans le conteneur `tools` **avant** de
démarrer la nouvelle version. Une migration de données s'écrit avec
`prisma migrate dev --create-only` puis en éditant le SQL généré.
