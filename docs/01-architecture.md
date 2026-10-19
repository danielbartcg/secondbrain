# Architecture

## Vue d'ensemble

```
Navigateur (web responsive)            Application mobile (à venir)
   │ cookie `session`                      │ Authorization: Bearer <token>
   ▼                                       ▼
┌──────────────────────── Next.js 15 (App Router) ────────────────────────┐
│  Pages serveur  ──lit──▶  src/lib/* (métier)  ◀──appelle──  /api/v1/*  │
│  (dashboard, projets…)    auth · mindmaps · projects · tasks ·          │
│                           documents · dashboard · uploads               │
│                                     │ Prisma                            │
└─────────────────────────────────────┼───────────────────────────────────┘
                                      ▼
                               PostgreSQL 16      data/uploads   data/documents
```

- **Une seule source de vérité métier** : `src/lib/`. Les route handlers
  `/api/v1` sont de simples adaptateurs HTTP (validation zod → métier →
  JSON). Les pages serveur lisent directement le métier ; les composants
  client mutent via `src/lib/client.ts` → API.
- **Pas de Server Actions** : tout ce que fait le web est faisable par un
  client externe (condition pour l'application mobile).
- **Contrats typés** : les DTO (`ProjectDto`, `TaskDetailDto`,
  `DashboardDto`…) sont définis dans `src/lib/*.ts` et importés par les
  composants (types uniquement) — le JSON de l'API est exactement ce que voit
  l'interface.

## Pile

Next.js 15.5 · React 19 · TypeScript 5 · Tailwind CSS 4 · Prisma 6 +
PostgreSQL 16 · React Flow 12 + d3-hierarchy (cartes) · TipTap 2 (notes
riches) · **amCharts 4** (tous les graphiques) · lucide-react (icônes) ·
Docker + Caddy en production.

## Authentification et droits

- E-mail + mot de passe (bcrypt coût 12, 72 octets maximum : limite de
  bcrypt). Sessions **opaques** de 256 bits, 90 jours ; la base ne stocke que
  l'**empreinte SHA-256** du jeton (`Session.token`, `hashSessionToken()`).
  La connexion compare toujours une empreinte bcrypt (factice si le compte
  n'existe pas : pas d'énumération par le temps de réponse). Web : cookie `session` HTTP-only,
  `SameSite=Lax`, `Secure` en production. Mobile : même jeton en
  `Authorization: Bearer` (prioritaire sur le cookie).
- Anti-CSRF : les requêtes mutantes authentifiées par cookie doivent porter
  un `Origin` égal à l'hôte (sans `Origin` : `Sec-Fetch-Site: cross-site`
  refusé) et un corps `Content-Type: application/json` (`parseBody`, sinon
  `415`) (`src/lib/api.ts`).
- Rate limiting en mémoire (`src/lib/rate-limit.ts`, 50 000 clés max, purge
  des fenêtres expirées) : `login`/`register` (10 / 15 min / IP) et `login`
  (10 / 15 min / compte), `users/lookup` (60 / 15 min / utilisateur),
  changement de mot de passe (10 / 15 min / compte), `uploads` (120 / 15 min),
  documents de projet (60 / 15 min), `sync/push` (300 / 15 min) par
  utilisateur. L'IP = valeur la plus **à droite** de `X-Forwarded-For` (posée
  par Caddy ; l'application n'est publiée que sur `127.0.0.1`).
- En-têtes de sécurité : `src/middleware.ts` pose la CSP des pages avec un
  **nonce** par requête (`script-src 'self' 'nonce-…' 'strict-dynamic'`,
  `'unsafe-eval'` en développement seulement ; amCharts 4 n'en a pas besoin) ;
  `next.config.ts` pose HSTS, `X-Frame-Options`, etc. et une CSP stricte sur
  `/api`, `/media`, `/downloads`. Les téléchargements de documents ont leur
  propre CSP (`sandbox`, sauf PDF).
- Changement de mot de passe (`POST /me/password`) : vérification de l'actuel,
  bcrypt coût 12, suppression des autres sessions du compte.
- `ALLOW_REGISTRATION=false` ferme l'inscription publique (défaut des
  nouvelles installations, `provision.sh`) ; les comptes se créent alors avec
  `scripts/create-user.ts`.
- **Projets partagés** : un projet est visible et modifiable par son
  propriétaire et par les membres de l'équipe rattachés à un compte
  (`ProjectMember.userId`). Suppression du projet et gestion de l'équipe :
  propriétaire seulement. Documents et commentaires : supprimables par leur
  auteur ou le propriétaire.
- **Cartes partagées** (`src/lib/map-access.ts`, `MindMapShare`) : une carte
  est lisible par son propriétaire et par les personnes avec qui il l'a
  partagée ; modifiable (nœuds, notes, titre, mise en page, tâches
  rattachées) par le propriétaire et les partages en écriture ; suppression
  et gestion des partages (`src/lib/map-shares.ts`) : propriétaire seulement.
  Toute fonction de carte appelle `requireMapAccess(userId, mapId,
  "read" | "write" | "owner")` (404 si inaccessible, 403 si droit
  insuffisant) ; les requêtes de liste utilisent `mapAccessWhere(userId)`
  (`mapWriteWhere` pour l'écriture) ; `checkNode(…, "read" | "write")` pour
  les tâches d'un nœud. Les écritures gardent le verrou de ligne (`mutateMap`).
  Les DTO de carte portent `access`, `owner` et `sharedWith` ; règle pure
  partagée : `src/lib/shared/map-access.ts`.
- **Rôles** (`src/lib/roles.ts`, `src/lib/users.ts`) : `User.role` = `USER` ou
  `ADMIN` ; le **super administrateur** est codé en dur
  (`SUPER_ADMIN_EMAIL = daniel.barral@outlook.com`, surchargeable par la
  variable d'environnement `SUPER_ADMIN_EMAIL`), toujours administrateur,
  jamais rétrogradable ; ce compte ne peut pas être créé par l'inscription
  publique (`409`), seulement par `scripts/create-user.ts`. On ne peut pas
  retirer son propre rôle d'admin. Routes `/api/v1/admin/**` :
  `requireAdmin(user)` ; les fonctions métier d'administration
  (`listUsersAdmin`, `listAllProjectsAdmin`, `getProjectAdmin`,
  `listAllTasksAdmin`) reçoivent l'utilisateur et le vérifient elles-mêmes ;
  **chaque** page `/admin/**` appelle `requireAdminPage()`
  (`src/lib/admin-page.ts`, `notFound()` sinon) — le layout seul ne suffit
  pas (rendu partiel RSC).
- Pages `(app)` qui lisent des données côté serveur : chacune appelle
  `requireUser()` elle-même (pas seulement le layout).
- Sortir une tâche de son projet (`projectId: null`) : réservé à son créateur
  (`Task.ownerId`) ou au propriétaire du projet (`403` sinon).
- Cartes et tâches : la fiche tâche ne liste que les nœuds des cartes de
  l'utilisateur ; les tâches d'un nœud et ses compteurs ne comptent que les
  tâches accessibles (`taskAccessWhere`).
- **Hiérarchie** : `User.managerId` (N+1) ; boucles refusées. Un manager voit
  ses N-1 directs (« Mon équipe ») et leurs tâches (`tasksOfUsersWhere`, même
  définition que `isMyTask`).
- **Consultation en lecture seule** : un administrateur lit toute tâche et tout
  projet (pages d'administration) ; un manager lit les tâches de ses N-1.
  `getTaskDetail` renvoie alors `canEdit: false` : la fiche est désactivée
  (`<fieldset disabled>` + `pointer-events: none`) et toutes les mutations
  restent soumises à `taskAccessWhere` (404 sinon). Aucun droit d'écriture
  n'est accordé par le rôle ou la hiérarchie.

## Profil et thèmes

- Nom affiché = « Prénom Nom » (`User.name`, recalculé par `updateProfile` et
  recopié dans les fiches `ProjectMember` rattachées au compte). Inscription :
  prénom + nom (`name` seul reste accepté pour les anciens clients).
- Photo : téléversée par `POST /uploads` puis `PATCH /me { avatarUrl }`
  (chemin `/media/…` validé). Sans photo, `Avatar` affiche une **silhouette**
  sur fond coloré. `MemberDto.avatarUrl` et `TaskComment.authorAvatarUrl`
  portent la photo des comptes.
- Thèmes : `light` (défaut), `dark`, `sepia`, `ocean`, `forest` —
  `User.theme`, posé côté serveur sur `<html data-theme>` (layout racine, pas de
  flash) ; chaque thème redéfinit les jetons de couleur `--color-*` dans
  `globals.css` (et les couleurs `prose`). Le thème sombre active aussi le thème
  sombre amCharts.

## Cartes mentales

- Stockage : arbre plat (`MindNode.parentId`, `order`), une racine par carte.
- Notes : HTML TipTap, assaini à l'écriture et à la lecture
  (`src/lib/sanitize.ts`). Images autorisées uniquement en `/media/…` ou
  `http(s)://`.
- Mise en page côté client, `src/lib/mindmap-layout.ts` (d3-hierarchy, sans
  React) — réutilisable dans l'application mobile. Rendu React Flow. Largeur
  d'un nœud = texte (estimé, 260 px max) **+ place des pastilles** (`extra` :
  œil « à surveiller », notes, tâches ouvertes, nœuds fermés masqués, nœuds
  repliés) : le titre n'est jamais mangé par les icônes ; le titre garde au
  moins 3 em visibles.
- **Positions libres** : un nœud déposé **sur** un autre s'y rattache ;
  déposé ailleurs, sa position est mémorisée (`MindNode.x/y`). Dans la mise en
  page, un nœud positionné manuellement entraîne sa descendance non
  positionnée du même décalage (branche groupée) ; les connecteurs choisissent
  leur côté selon la position réelle. « Affichage optimisé »
  (`DELETE /mindmaps/:id/layout`) efface toutes les positions après
  confirmation et revient à la mise en page automatique.
- Mutations optimistes avec identifiants temporaires résolus à la réponse ;
  requêtes sérialisées (file d'attente) ; verrou de ligne `MindMap` côté
  serveur.
- **Statut de nœud** (`MindNode.status`) : `OPEN` · `WATCH` (à surveiller :
  halo ambré, icône œil) · `CLOSED` (fermé : hachuré, barré, et **masqué
  avec sa descendance** tant que « Afficher les nœuds fermés » est inactif ;
  le parent affiche un badge `✓n`). Le filtrage se fait côté client avant la
  mise en page (`visibleNodes` dans `MindMapEditor`).

## Gestion de projet

- **Prérequis** (`Task.prerequisiteIds`) : une tâche peut dépendre d'autres
  tâches du même projet ; règles pures partagées serveur / application
  (`src/lib/shared/prerequisites.ts` : même projet, pas soi-même, pas de cycle ;
  conflit de planning = échéance du prérequis postérieure au début). Fiche
  tâche : bloc Calendrier ; fiche projet : onglet **Gantt** (amCharts 4,
  `GanttChart`) en échelle jour / semaine / mois, barres glissables qui
  décalent début et échéance (option : décaler aussi les tâches dépendantes).
- **Épingles** (`src/lib/pins.ts`, `pins-store.ts`) : projets et cartes
  épinglés par chaque utilisateur, listés en retrait sous « Projets » et
  « Cartes mentales » dans le menu de gauche (fournis par le layout serveur,
  rafraîchis côté client).
- Hiérarchie : `Project? › Stage? › Activity? › Task` : **les trois niveaux
  sont facultatifs** pour une tâche (invariant : activité ⇒ étape ⇒ projet,
  résolu par `resolveAttachment()`). Une tâche sans projet est « orpheline » :
  visible par son seul créateur (`Task.ownerId`), listée dans le projet virtuel
  **« Sans projet »** (`/projects/sans-projet`) et dans les tableaux de bord.
  Une tâche de projet sans étape apparaît dans « Tâches sans étape » du Plan et
  compte dans l'avancement du projet. Plus **équipe**
  (`ProjectMember`), **livrables** (`Deliverable`, rattachables à une étape,
  avec responsable, dates attendues, statut), **documents** (`Document`,
  pouvant matérialiser un livrable) et **commentaires de tâche**
  (`TaskComment`, mentions `@[Nom](memberId)`, **fil hiérarchique** par
  `parentId` : réponses aux réponses, profondeur libre, suppression en
  cascade).
- Chaque tâche porte une **priorité** (`LOW · MEDIUM · HIGH · CRITICAL`) et
  une **complexité** estimée (`LOW · MEDIUM · HIGH`), utilisées par la vue
  « Sélection ». Couleurs d'item nuancées par priorité : `PRIORITY_CHIP`
  (`src/components/ui.tsx`).
- L'avancement n'existe **que sur les tâches** (`progress`, `status`,
  `reconcile()`). Les niveaux supérieurs sont agrégés à la volée
  (`aggregate()`). Rien n'est dénormalisé.
- Toute mutation renvoie le projet complet recalculé ; aucune logique
  d'agrégation côté client. Les mutations de **tâche** renvoient
  `{ project | null, task }` (`null` sans projet ; le client recharge alors).
- Toutes les mutations passent par `mutateProject()` / `mutateTask()` :
  transaction + `SELECT … FOR UPDATE` sur la ligne `Project` (anti-interblocage)
  + rechargement du projet dans la même transaction.
- Accès aux tâches : `taskAccessWhere(userId)` = tâches de mes projets +
  mes tâches sans projet. Affectations et rattachements sont vérifiés comme
  appartenant au même projet (`checkMember`, `checkStage`) ; changer de
  projet retire l'affectation ; une tâche sans projet n'est pas affectable.
- **Tâches ↔ nœuds de carte** (`MindNodeTask`, n-n) : depuis un nœud on crée
  une tâche (sans projet, rattachée) ou on rattache une tâche existante
  (recherche). Le nœud affiche le nombre de tâches **non clôturées** (terminées
  comprises) ; la fiche tâche liste ses nœuds (détachables).

## Prise de notes (`src/lib/notes.ts`)

Arborescence façon Notion de **tous les objets**, chargée **de proche en
proche** (`GET /notes/tree?parent=<ref>` ne renvoie que les enfants directs,
avec `hasChildren` / `hasNotes`) :
`root › section:mindmaps › mindmap:<id> › node:<id> › …` et
`root › section:projects › project:<id> › stage:<id> › activity:<id> › task:<id>`
(+ tâches sans étape sous le projet, tâches sans activité sous l'étape,
`section:orphans` pour les tâches sans projet). Références `kind:id`.

Chaque objet porte un **document de notes riches** (HTML TipTap, assaini à
l'écriture et à la lecture) : `Project.notes`, `Stage.notes`,
`Activity.notes`, `Task.notes` ; pour une carte mentale, ce sont les notes de
son **nœud racine**, et pour un nœud la zone « Notes » déjà présente dans
l'éditeur de carte (`MindNode.notes`). Les sections ne sont pas éditables.
Les notes sont **visibles sur l'objet** : aperçu `NotesPreview` (projet, fiche
tâche), icône carnet sur les étapes / activités / tâches du Plan, lien
« Ouvrir dans Prise de notes » dans le panneau de carte ; DTO `hasNotes`.

## PWA (iPhone, Android)

En attendant l'application iPhone (TestFlight), le site s'installe sur l'écran
d'accueil : `src/app/manifest.ts` (`display: standalone`, démarrage sur
`/dashboard`, raccourcis), icônes `public/icons/*` et `src/app/apple-icon.png`
(issues de l'icône iOS), `appleWebApp` dans `layout.tsx`, marges
`env(safe-area-inset-*)` (côtés, tiroirs fixés en bas). **Pas de service
worker** : le site reste strictement en ligne (décision) ; le hors-ligne est
le rôle des applications desktop et iPhone. Notifications push web possibles
plus tard (iOS 16.4+, PWA installée).

## Application native (`native/`)

Application desktop Windows (Electron) qui embarque l'interface du site et
fonctionne hors ligne sur les projets et cartes (docs/05-offline-sync.md) :
- les écrans sont les composants de `src/components`, empaquetés par Vite ;
  `next/link` / `next/navigation` sont remplacés par un petit routeur ;
- `api` (`src/lib/client.ts`) reçoit un transport (`setApiTransport`) qui
  sert `/api/v1` depuis une **API locale** sur IndexedDB ; sur le site il
  reste nul ;
- les DTO et règles pures sont partagés via `src/lib/shared/`
  (`project-model.ts`, `task-model.ts`), réexportés par `projects.ts` et
  `tasks.ts` : **toute règle métier pure se modifie là**, une fois pour les
  deux côtés ;
- `AppShell` accepte un `statusSlot` (état de synchro dans l'application) ;
- même client pour l'iPhone via **Capacitor** (`capacitor.config.ts`, projet
  Xcode `native/ios`, build par GitHub Actions macOS) ; `platform()` distingue
  desktop, iOS et navigateur.

## Synchronisation hors ligne (`src/lib/sync.ts`)

Parité stricte site / application (décisions et mécanismes : docs/05, § 8 ter).

Socle serveur des applications desktop / iPhone (détail : docs/05-offline-sync.md).
- Un **déclencheur PostgreSQL** (`sb_sync_log`) journalise dans `SyncLog` toute
  écriture sur les tables synchronisées (création, champ modifié, suppression),
  quelle que soit son origine (web ou application). Aucune fonction métier n'a
  à s'en soucier ; une nouvelle table synchronisée = un `CREATE TRIGGER` +
  sa portée dans la fonction.
- `GET /sync/pull` : instantané puis changements depuis un curseur, avec la
  version (`seq`) de chaque champ ; `POST /sync/push` : rejoue les
  opérations hors ligne **par les fonctions métier existantes**, conflit par
  champ (le serveur gagne), idempotence par `opId` (`AppliedOp`).
- Version de protocole `SYNC_PROTOCOL_VERSION` (en-tête `X-Sync-Protocol`) :
  une application incompatible reçoit 426 et doit se mettre à jour. Pas de
  compatibilité ascendante à maintenir.
- Le **site web reste strictement en ligne** (décision du 14/10/2026).
- Tests de bout en bout : `npm run test:sync` (`scripts/sync-e2e.ts`).

## Recherche globale (`src/lib/search.ts`)

`GET /api/v1/search?q=` : projets (nom, description), tâches (nom,
description), nœuds de carte (titre, notes HTML) et cartes (titre), filtrés
par les accès de l'utilisateur, `contains` insensible à la casse, 6 par type.
Chaque résultat porte `href` vers la page dédiée (`/tasks/:id`,
`/projects/:id`, `/mindmaps/:id?node=:nodeId` qui sélectionne et centre le
nœud). Composant `GlobalSearch` (accueil) : saisie différée 250 ms, résultats
groupés, navigation clavier, pleine largeur sur mobile.

## « Mes tâches » et organisation personnelle (`src/lib/tasks.ts`)

Chaque tâche a un **responsable** (`assigneeId`), un **superviseur**
(`supervisorId`, un seul membre) et des **contributeurs** (`TaskContributor`,
plusieurs membres), tous membres du même projet (vérifiés, retirés au
changement de projet, impossibles sans projet). Les nouveaux impliqués à
compte reçoivent une notification `ASSIGNED`.

Définition commune (`isMyTask`) : une tâche est « à moi » si je suis son
responsable, son superviseur ou l'un de ses contributeurs (membre rattaché à
mon compte), **ou** si elle n'est affectée à personne dans un projet dont je
suis propriétaire (usage solo). `OrganizerTask.roles` dit pourquoi. Sert au
tableau de bord et à la page **Organiser mes tâches** (`/organize`,
`GET /api/v1/me/tasks`), qui propose trois vues sur les tâches ouvertes des
projets actifs / en pause :

- **Calendrier** (`CalendarView`) : grille mensuelle ; glisser une tâche sur
  un jour crée une **session de travail** (`WorkSession`, un jour par ligne,
  propre à l'utilisateur, `@@unique([taskId, userId, date])`). Une tâche
  planifiée se grise mais reste déposable ; les sessions se déplacent et se
  retirent ; une session postérieure à l'échéance est signalée (`late`).
  Repli tactile : cliquer la tâche puis le jour.
- **Sélection** (`MatrixView`) : matrice priorité × complexité ; déposer une
  carte met à jour `priority` / `complexity` (`PATCH /tasks/:id`).
- **Synthèse** (`SynthesisView`) : tableau réordonnable ; l'ordre relatif est
  **personnel** (`TaskRank`, `PUT /me/tasks/order`), indépendant de l'ordre
  du plan.
- **Kanban** (`KanbanView`) : colonnes par statut avec filtre (semaine par
  échéances, semaine par sessions de travail, assignation, supervision,
  contribution, toutes).

Le composant **`KanbanBoard`** (`src/components/tasks/`) est partagé entre
« Mes tâches » et l'onglet Kanban d'un projet : une colonne par statut
(Clôturée repliée), cartes glissables (changement de statut via
`PATCH /tasks/:id`), menu « … » pour le tactile, lien vers la fiche. Les
liens internes des cartes sont `draggable={false}` pour que le glisser porte
sur la carte.

Glisser-déposer natif HTML5 (`dataTransfer` typé `application/x-sb-*`),
mutations optimistes avec rechargement en cas d'erreur (`TaskOrganizer`).

## Notifications in-app (`src/lib/notifications.ts`)

Table `Notification` (destinataire, type, titre, texte, `href`, `readAt`).
Émises dans la transaction de l'action, jamais à l'auteur de l'action :

| Type | Déclencheur | Destinataire | Lien |
| --- | --- | --- | --- |
| `ASSIGNED` | tâche créée ou ré-affectée ; ajout comme superviseur ou contributeur | membre impliqué (compte) | fiche tâche |
| `TASK_UPDATED` | nom, description, statut/avancement, priorité, complexité, dates, rattachement, nouveau commentaire | membre affecté | fiche tâche ; **regroupée** : une seule non lue par tâche, rafraîchie |
| `REPLY` | réponse à un commentaire | auteur du commentaire parent | fiche tâche `#comment-<id>` |
| `MENTION` | `@[Nom]` d'un membre à compte | membre mentionné | idem |

| `MESSAGE` | nouveau message dans une conversation | autres participants | `/messages/<id>` ; **regroupée** par conversation ; lue quand la conversation est lue |

**Administration → Notifications** (`src/lib/settings.ts`) : chaque type
peut être désactivé pour tout le monde (plus créé du tout) et privé de copie
e-mail. **Copies e-mail** : `notify()` marque la notification
`emailState = PENDING` si l'envoi est activé (serveur SMTP + expéditeur +
interrupteur), le type le permet et le destinataire n'a pas désactivé les
e-mails (Préférences). L'envoyeur `src/lib/mailer.ts` (nodemailer), démarré
par `src/instrumentation.ts` dans le processus Next, relève les notifications
en attente **toutes les 10 s, hors transaction** (jamais d'appel SMTP dans une
transaction), 20 par passage, abandon après 24 h. Une notification regroupée
qui se rafraîchit ne renvoie pas d'e-mail. Le mot de passe SMTP est chiffré
(AES-256-GCM, clé dérivée de `SESSION_SECRET`) et jamais renvoyé au client.

**Mise en forme** (`renderMail`, `renderNotificationMail`) : chaque e-mail part
en HTML soigné **et** en texte. Gabarit commun en tableaux et styles en ligne
(Outlook, Gmail, Apple Mail) : ligne d'aperçu, logo, carte blanche avec
liseré de marque, pastille (type de notification avec pictogramme, ou
« Bienvenue », « Sécurité du compte »…), titre, texte en paragraphes — ou
**citation** pour les commentaires, mentions, réponses et messages —, bouton
compatible Outlook (VML) au libellé adapté (« Voir la tâche », « Lire le
message », « Confirmer mon adresse »…), lien de secours, pied de page avec
la raison de l'envoi et le lien vers les préférences. Tout texte variable
passe par `escapeHtml()`.

**E-mails de compte** (`src/lib/account-email.ts`, seulement si l'envoi est
configuré) : bienvenue + lien de validation à l'inscription, validation
après changement d'adresse, mot de passe oublié (lien 1 h, ferme toutes les
sessions). Liens à usage unique (`EmailToken`, empreinte seule). La
validation est **informative** : elle n'empêche jamais la connexion ; elle
est visible dans Administration → Utilisateurs.

Client : magasin partagé `src/lib/notifications-store.ts` (un seul
rafraîchissement toutes les 60 s + au focus, partagé entre la cloche de la
barre latérale et celle de l'en-tête mobile), composant `NotificationsBell`
(compteur, panneau, clic = marquer lue + naviguer, bascule lue / non lue,
« Tout lu ») et page `/notifications`.

## Messagerie interne (`src/lib/messages.ts`)

Conversations entre deux utilisateurs ou plus (`/messages`) : accès réservé
aux participants (`requireParticipant`, 404 sinon) ; contacts proposés =
membres de mes projets, manager et N-1, interlocuteurs passés (tout le monde
pour un administrateur), les autres par e-mail exact (`/users/lookup`).
Messages en HTML assaini (`sanitizeNotes` à l'écriture et au rendu), même
éditeur riche que les notes en variante compacte (emoji, images collées,
Ctrl+Entrée). Réponse à un message précis (`replyToId`, citation cliquable
qui met le message d'origine en évidence). Vu / non vu par participant
(`lastReadAt`) : coches « envoyé » / « vu », « Vu par … » en groupe,
séparateur « Nouveaux messages », « Marquer comme non lu ». Suppression par
l'auteur (contenu effacé, place conservée). Rafraîchissement par
interrogation : le fil ouvert toutes les 4 s (`?since=`), la liste toutes les
15 s, le badge du menu toutes les 30 s (`messages-store.ts`). 300 envois /
15 min / utilisateur. En ligne uniquement dans l'application desktop.

## Connecteur MCP pour Claude (`src/lib/mcp.ts`)

Serveur MCP « Streamable HTTP » **sans état** sur `POST /api/v1/mcp`
(JSON-RPC 2.0, réponses JSON, pas de flux SSE ; protocole 2025-06-18,
2025-03-26 ou 2024-11-05). Authentification par **clé d'accès personnelle**
`Authorization: Bearer sb_…` (`src/lib/api-keys.ts`, Préférences →
Connecteur Claude) ; une clé ne vaut pas session et inversement. Outils
**en lecture seule**, qui réutilisent la logique métier avec le périmètre de
l'utilisateur : `whoami`, `get_dashboard`, `list_projects`, `get_project`,
`list_my_tasks`, `list_tasks` (N-1), `get_task`, `list_mind_maps`,
`get_mind_map`, `browse_notes`, `read_note`, `search`, `list_users`
(administrateurs).

**Requêtes souples sur tous les objets** (`src/lib/mcp-query.ts`,
outil `query_objects`) : une seule entrée pour projet, étape, activité,
tâche, commentaire, réunion (compte-rendu), risque / opportunité, livrable,
document, dossier, carte mentale, nœud, conversation, message, notification ;
filtres `author` (« me » = moi, sinon nom), `assignee`, `project_id`,
`map_id`, `task_id`, `status`, `text`, fenêtres `created_after/before`,
`updated_after/before` ; tri `created` / `updated`, ordre, `limit` (20, 200
max) ; `with_content` renvoie le texte intégral (sinon extrait de 400
caractères). **Chaque élément porte `createdAt` / `updatedAt`** : « mes trois
derniers CR » = `{ entity: "meeting", author: "me", limit: 3 }`. Raccourcis :
`list_recent_tasks` (dernières créées / modifiées / clôturées),
`list_meetings` (comptes-rendus avec statut de validation), `get_meeting`
(intégral). Messages, conversations et notifications restent personnels ;
le reste suit le périmètre (`projectAccessWhere`, `taskAccessWhere`,
`mapAccessWhere`, modèles exclus). L'écriture de tous ces objets passe par
les outils dédiés ou `api_request` (ci-dessous). Un **administrateur** n'accède aux projets et tâches des
autres que s'il le demande **explicitement** (`admin_access: true`) ; sans ce
drapeau, son périmètre est le sien.

**Écriture** (`src/lib/mcp-write.ts`, clés `canWrite`, défaut à la création) :
les outils d'écriture appellent l'API REST `/api/v1` **en boucle locale**
(`INTERNAL_API_URL` ou `http://127.0.0.1:$PORT`) avec une **session
éphémère** (120 s, supprimée après l'appel) de l'utilisateur : mêmes droits
(anti-IDOR, `canEdit`), validations zod, notifications et piste d'audit que
l'interface. Outils dédiés : `create_task`, `update_task`,
`bulk_update_tasks` (filtre étape / activité / statut / responsable / nom ;
responsable, superviseur, statut, priorité, complexité, décalage de dates ;
`dry_run` ; 500 max), `delete_task`, `add_comment`, `create_project`,
`update_project`, `create_stage`, `save_note`, `create_meeting`,
`update_meeting`, `decide_meeting`, `upsert_risk`, `edit_mind_map`,
`send_message` ; les personnes se désignent par id, e-mail ou nom. Pour tout
le reste : `api_reference` (sert `docs/04-api.md`, copié dans l'image Docker)
et `api_request` (n'importe quelle route, sauf auth, clés, mot de passe,
e-mail, sync et mcp). Une clé en lecture seule ne voit pas ces outils et un
appel est refusé. Protection « DNS rebinding » (en-tête
`Origin` étranger refusé), 600 requêtes / 15 min / compte. Claude Desktop s'y
connecte via `mcp-remote` (configuration générée dans les Préférences) ;
Claude Code via `claude mcp add --transport http`.

## Tableau de bord personnel (`src/lib/dashboard.ts`)

Agrège, pour les projets actifs / en pause accessibles : mes tâches
(`isMyTask`), échéances (tâches non terminées et livrables
non livrés, sous un horizon de 30 jours, retards inclus), répartitions par
statut, avancement global. Exposé par `GET /api/v1/dashboard` pour le mobile.
Compteurs calculés **en base** (`groupBy`, `aggregate`, `count`) ; listes
plafonnées à 100 (`DASHBOARD_LIST_LIMIT`) : la réponse reste légère quel que
soit le volume. « Mes tâches » (`getMyTasks`) filtre aussi en base
(`tasksOfUsersWhere`) au lieu de charger toutes les tâches accessibles. Les
résumés de projets (`listProjects`, administration) agrègent l'avancement par
`groupBy` sans charger les tâches.

## Fichiers

| Usage | Répertoire | Service | Accès |
| --- | --- | --- | --- |
| Images collées dans les notes | `DATA_DIR/uploads/AAAA/MM/` | `/media/[...path]` | public, URL non devinable (128 bits), cache 1 an |
| Documents de projet | `DATA_DIR/documents/<projectId>/` | `/api/v1/documents/:id/download` | authentifié, accès projet vérifié |

Règles communes (`src/lib/uploads.ts`) : allowlist MIME, taille bornée
(10 Mo images, 25 Mo documents), nom aléatoire, pas de SVG, chemin borné au
répertoire racine. Les deux répertoires sont montés en volume Docker et
inclus dans les sauvegardes. Caddy accepte 30 Mo de corps de requête.

## Piste d'audit des tâches (`src/lib/task-events.ts`)

Table `TaskEvent` : une ligne par modification, message lisible figé à
l'écriture (« Alice a modifié la date de début du 12/10/2026 au 13/10/2026 »,
« … a assigné la tâche à Bob », « … a ajouté le prérequis « Murs » », « … a
commenté : « … » », « … a lié la tâche au risque « … » »…). Écrite **dans la
transaction** de chaque mutation : `createTask` / `updateTask` comparent un
instantané avant / après (`taskSnapshot`, `diffTaskEvents` : nom,
description, statut, avancement, priorité, complexité, dates, clôture,
responsable, superviseur, contributeurs, prérequis, rattachement) ;
commentaires, sessions de travail, nœuds de carte et risques appellent
`recordTaskEvents`. Les écritures rejouées par la synchro passent par les
mêmes fonctions : l'application hors ligne est auditée aussi. Lecture :
`GET /tasks/:id/history` (mêmes droits que la fiche).

## Piste d'audit des cartes mentales (`src/lib/map-events.ts`)

Table `MapEvent`, même principe (message figé, écrit **dans la transaction**) :
création et renommage de la carte, nœud ajouté (« sous » son parent), renommé,
déplacé (de … vers …), supprimé (avec la taille de la branche), notes,
statut, couleur ; tâche rattachée, détachée ou créée depuis un nœud ;
partage, changement de droit, retrait, départ ; affichage optimisé. Non
journalisés : positions manuelles et repli. Les enregistrements automatiques
de notes d'un même auteur sur un même nœud sont regroupés (séance de 10 min).
`nodeId` sans clé étrangère (le nœud peut être supprimé), `nodeTitle` figé.
Lecture : `GET /mindmaps/:id/history?nodeId=` (droit de lecture sur la carte),
panneau « Historique » de l'éditeur, outil MCP `get_map_history`.

## Modèles : projets types et cartes types (`src/lib/templates.ts`)

Un modèle est un vrai projet / une vraie carte avec `isTemplate = true` :
mêmes écrans, mêmes fonctions métier. **Accès** : `projectAccessWhere` /
`mapAccessWhere` excluent les modèles (listes, tableau de bord, recherche,
« Mes tâches », activité, synchro, MCP en lecture) ; les contrôles d'accès
unitaires utilisent `projectEditWhere` / `taskEditWhere` (asynchrones) qui
y ajoutent les modèles pour un **administrateur** (droits de propriétaire) ;
`requireMapAccess` fait de même pour les cartes types
(`src/lib/template-access.ts`, `isAdminId`). Règle : une liste / un
périmètre utilise `projectAccessWhere`, l'ouverture ou la modification d'un
objet précis `projectEditWhere`.
**Mode modèle** (écrans) : projet — onglets Plan, Livrables, Risques ; ni
dates, statut, avancement, équipe, affectations, champs personnalisés,
export, épingle ; tâches sans statut / avancement / dates / personnes /
sessions / commentaires / nœuds ; livrables sans statut / responsable / dates
/ documents ; risques sans statut / responsable. Carte — bandeau « Carte
type ».
**Appliquer** (`applyProjectTemplate`, `applyMapTemplate`, dans la
transaction verrouillant la cible) : à la création (`templateId`) ou ensuite
sur une cible vide (projet sans étapes, tâches, livrables, risques ni
dossiers — propriétaire ; carte réduite à sa racine — droit d'écriture ;
409 sinon). Copie : étapes, activités, tâches (nom, description, notes,
priorité, complexité, ordre, prérequis remappés ; « à faire », 0 %),
livrables (« prévu »), risques (« ouvert », stratégie, tâches liées
remappées), dossiers ; description, notes et couleur si vides ; nœuds de
carte (titre, notes, couleur, statut, ordre, repli, positions). Jamais :
dates, équipe, affectations, réunions, documents, liens tâche ↔ nœud.
Tracé : TaskEvent « (modèle « X ») », MapEvent « a appliqué la carte type ».
Création d'un modèle vierge ou depuis la structure d'un projet / d'une carte
(`createProjectTemplate`, `createMapTemplate`). Application desktop : une
création avec modèle et toute action sur un objet absent de la base locale
sont relayées au serveur.

## Champs personnalisés des projets (`src/lib/custom-fields.ts`)

Définis globalement par les administrateurs (Administration → Champs
personnalisés) : libellé, type **texte libre** ou **liste de valeurs**
(gérée là), ordre, archivage. Valeurs dans `Project.customFields` (JSON
`{ fieldId: texte | id d'option }`) : renommer une valeur la renomme partout ;
retirer une valeur ou supprimer un champ l'efface des projets (même
transaction) ; archiver masque le champ en gardant les valeurs. Validation
pure partagée (`src/lib/shared/custom-fields.ts`, `applyCustomPatch` :
une valeur de liste peut être donnée par identifiant ou libellé exact)
appliquée par `createProject` / `updateProject` (fusion : `null` vide) et
par l'application hors ligne (définitions en cache). Colonne synchronisée
comme les autres. Affichage : bloc « Informations » de la fiche projet,
pastilles de la liste des projets et de la vue d'administration, export
Excel, connecteur MCP (`list_custom_fields`, `customFields` lisibles dans
`get_project` / `list_projects` — filtre « Libellé=valeur » —,
`update_project` `custom_fields`).

## Rapport d'activité (`src/lib/activity.ts`)

« Qu'est-ce qui a évolué » sur une fenêtre libre : périodes prédéfinies
(aujourd'hui, hier, 7 / 30 / 90 jours, cette semaine, semaine dernière, ce
mois-ci, mois dernier) ou dates libres (366 jours au plus), jours de Paris
(`src/lib/shared/activity-period.ts`, pur). Consolide, dans le périmètre de
l'utilisateur (ou toute la plateforme pour un administrateur qui le demande) :
pistes d'audit des tâches et des cartes, réunions (créées, compte-rendu
modifié, validations / refus), risques et opportunités, livrables et
documents, projets et étapes créés. Regroupé par projet et par carte (tâches
et nœuds les plus actifs d'abord, 30 derniers messages chacun), compteurs
(créées, terminées, clôturées, rouvertes, replanifiées, affectations,
commentaires…), personnes actives, activité par jour. Un seul calcul sert la
page « Activité » (site et application, en ligne), `GET /api/v1/activity` et
l'outil MCP `get_activity` : Claude obtient tout en un appel et rédige la
synthèse. Limite : une tâche supprimée emporte son historique.

## Réunions de projet (`src/lib/meetings.ts`)

Réunion = titre, date, lieu, rédacteur (créateur), participants et
validateurs (membres ; un validateur doit avoir un compte), compte-rendu en
texte riche assaini. Modifiable par le rédacteur ou le propriétaire du
projet (verrou de ligne sur la réunion). Circuit de validation : chaque
validateur valide ou refuse (motif obligatoire) → `MEETING_DECISION` au
rédacteur ; **toute modification du compte-rendu remet les décisions à
« en attente »** et notifie les validateurs (`MEETING_REVIEW`, regroupée par
réunion, lien `/projects/:id?meeting=…#reunions`). Statut calculé : brouillon,
sans validation, en validation, validé, refusé.

## Risques et opportunités (`src/lib/risks.ts`)

Registre par projet (`Risk` : nature, probabilité × gravité / bénéfice 1–5,
criticité p × i et niveau, statut, responsable, plan, échéance) ; tâches liées
(`RiskTask`, même projet, liens tracés dans l'historique des tâches).
Règles pures partagées : `src/lib/shared/risks.ts`. Verrou de ligne du projet.

## Export Excel (`src/lib/project-export.ts`)

`GET /projects/:id/export` (exceljs, rendu côté serveur, paquet externe) :
classeur mis en forme comme un livrable (couleur du projet, défaut
#4F5FF0) : **Synthèse** (bandeau, indicateurs en cartes, barre d'avancement,
répartitions par statut / priorité / niveau de risque / statut de livrable
avec barres, avancement par étape, champs personnalisés « Informations »,
sommaire avec liens, description et notes), **Tâches** (références T1…,
pastilles de statut / priorité / complexité, retards en rouge, prérequis,
risques liés, notes en texte), **Planning** (hiérarchie étape › activité › tâche : barres de synthèse des étapes et activités, du premier début à la dernière échéance de leurs tâches, colonne d'avancement ; Gantt par semaines — par mois au-
delà de 78 semaines — dessiné par mise en forme conditionnelle, rapide à
4 000 tâches, semaine courante surlignée), Étapes & activités (étapes en
lignes de groupe), Livrables, Risques & opportunités (couleurs de niveau,
stratégie), Matrices 5 × 5 en tuiles, Réunions (comptes-rendus, validations
colorées), Équipe, Documents. Chaque feuille : titre, sous-titre, en-tête
coloré, lignes alternées, volets figés, filtres, formats typés, impression A4
paysage ajustée en largeur avec pied de page. `renderProjectWorkbook(data)`
construit le classeur sans base (testable). 30 exports / 15 min / utilisateur. Dans l'application desktop, la
coque relaie cette route avec le jeton (liste blanche).

## Export PowerPoint « état des lieux » (`src/lib/project-pptx.ts`)

`GET /projects/:id/export-pptx` (pptxgenjs 4.0.1, rendu côté serveur, paquet
externe — `serverExternalPackages` ; seule dépendance chargée : jszip, tracée
par le build autonome). Présentation 16:9 aux couleurs du projet (défaut
#4F5FF0), masque commun (filet de couleur, pied de page : projet, « État des
lieux · export du … », numéro). Diapositives : **Titre** (statut, chef de
projet, dates, avancement, équipe, champs personnalisés), **Synthèse** (7
indicateurs en cartes, anneau natif des tâches par statut, fiche projet avec
étape en cours, prochain jalon, tâches non affectées et champs personnalisés),
**Avancement par étape** (barres natives + tableau fait / total, dates,
retards), **Planning des étapes** (frise mensuelle ou trimestrielle dessinée
en formes : barres avec avancement, contour rouge si échéance dépassée,
jalons, ligne « Aujourd'hui »), **Points d'attention** (10 tâches les plus en
retard, compteurs retard / critiques / bloquées par un prérequis ouvert),
**Risques** puis **Opportunités** sur deux diapositives (registre trié par criticité, stratégie,
matrice 5 × 5 lisible pour chacun, libellés des axes), **Livrables**, **Réunions et décisions**
(10 plus récentes, statut de validation), **Équipe et charge** (ouvertes /
en retard / terminées par membre + barres empilées natives), **Prochaines
étapes** (échéances de tâches, livrables et étapes à 30 jours). Chaque
diapositive de contenu porte un **encadré à commenter** (note jaune en
pointillés « 💬 Commentaire du chef de projet — Cliquez pour commenter : … »)
qui occupe la place laissée par le contenu. Tableaux paginés (lignes
plafonnées, pages équilibrées, 3 à 4 pages au plus, puis « + N … — détail
complet dans l'export Excel ») ; diapositives sans données : message sobre et
grand encadré. Uniquement des agrégats : ~0,2 s de rendu pour 4 000 tâches
(≈ 0,8 s requête comprise). Projets types exclus (404). `renderProjectDeck(data)`
construit la présentation sans base. Même quota que l'export Excel
(`export:<userId>`, 30 / 15 min) ; relayée par la coque desktop (liste
blanche `PROJECT_EXPORT`).

## Second cerveau : liens, fraîcheur, résurgence, référence, voyage dans le temps, iCal

Fonctions sans IA, calculées à partir des données existantes (décision du
18/10/2026). Toutes **en ligne** (dans l'application native, routes relayées
au serveur ; écrans masqués ou « Disponible uniquement en ligne » hors
connexion). Tests : `npm run test:knowledge` (pur) et
`npm run test:knowledge-e2e` (API, droits).

- **Liens entre objets** (`src/lib/links.ts`, `src/lib/shared/links.ts`) :
  `[[` dans l'éditeur riche insère `<a href data-ref="kind:id">`. **Décision :
  pas de table de liens** — les liens vivent dans le HTML des notes ;
  `sanitizeNotes` garde `data-ref` (motif strict) sur les seuls liens
  internes. Rétroliens et graphe cherchent `data-ref="…"` (`contains`) dans
  les notes des projets, étapes, activités, tâches, nœuds et les
  comptes-rendus de réunion, filtrés par les périmètres habituels (modèles
  exclus) : toute écriture (site, application hors ligne rejouée, MCP,
  modèles) est prise en compte sans code supplémentaire. Cibles
  inaccessibles écartées du graphe. Navigation : écouteur de clic dans
  `AppShell` (`router.push`, aussi dans l'application native).
- **Fraîcheur** (`src/lib/freshness.ts`) : dernière activité d'une tâche =
  max(`Task.updatedAt`, dernier `TaskEvent`) ; d'un projet = max des lignes du
  projet, étapes, livrables, risques, réunions, documents, tâches et pistes
  d'audit (agrégats `groupBy` + une requête paramétrée). Préfiltre en base
  (`updatedAt < seuil`), listes bornées. Seuil personnel `User.staleDays`
  (14 j par défaut). Tâches ouvertes seulement (TODO / IN_PROGRESS), projets
  **actifs** seulement (en pause = volontairement arrêté).
- **Résurgence** (`src/lib/resurface.ts`, règles pures
  `src/lib/shared/leitner.ts`) : 3 notes par jour (jour de Paris) — cartes
  échues d'abord, puis notes jamais relues (non vides, non modifiées depuis
  30 j) dans un ordre pseudo-aléatoire stable pour la journée (FNV-1a). Boîtes
  1–5 à 3 / 10 / 30 / 90 / 180 jours ; « Toujours utile » monte d'une boîte,
  « À revoir bientôt » revient en boîte 1, « Ne plus proposer » archive. Le
  quota du jour baisse à chaque réponse (pas de remplacement). Une note
  devenue inaccessible ou vide est écartée et sa carte supprimée.
- **Planning de référence** (`src/lib/baselines.ts`, glissements purs dans
  `ganttModel.ts` : `baselineSpans`, `stageSlips`, `baselineSummary`) :
  instantané JSON des dates des étapes et tâches, pris sous le verrou du
  projet, 20 par projet. Le glissement compare les **fins** (positif = retard).
- **Voyage dans le temps** (`src/lib/time-travel.ts`, règles pures
  `src/lib/shared/time-travel.ts`) : on part de l'état actuel et on défait les
  évènements d'audit postérieurs à la date (libellés retraduits : « En
  cours » → `IN_PROGRESS`, « 15/10/2026 », « 40 % », noms) ; objets créés
  après la date exclus ; avancement rendu cohérent avec le statut. Cartes :
  titres, statuts, couleurs défaits ; nœuds supprimés depuis connus par leur
  titre ; déplacements signalés, non défaits. Courbe d'avancement : 40 points
  de la création du projet à aujourd'hui. Limites : tâche supprimée = son
  historique perdu ; étapes sans piste d'audit (nom actuel).
  **Gantt à la date** (client, `TimeTravelPanels.ganttAt`) : structure
  actuelle du plan peuplée des tâches d'alors (dates, statut, avancement
  défaits), étapes à l'étendue de leurs tâches, `GanttView` en `readOnly` ;
  mode « Aujourd'hui comparé » = Gantt actuel + version passée en
  `baseline`. **Risques à la date** : les risques n'ayant pas de piste
  d'audit, le déclencheur PostgreSQL `sb_risk_snapshot` (AFTER INSERT /
  UPDATE / DELETE sur `Risk`) enregistre un instantané complet
  (`RiskSnapshot`, `to_jsonb`, horodaté en UTC explicite) à chaque
  écriture, sans code applicatif (création de projet depuis un modèle
  comprise) ; `risksAt` (pur) prend le dernier instantané ≤ date (absent si
  supprimé) et signale « modifié / supprimé depuis ». Risques antérieurs au
  19/10/2026 : un instantané de leur état d'alors, daté de leur création.
- **Flux iCal** (`src/lib/calendar-feed.ts`, générateur pur
  `src/lib/shared/ical.ts`) : URL secrète `cal_` + 256 bits (empreinte
  SHA-256 seule en base, `CalendarFeed`), route publique
  `/api/v1/calendar/:token.ics` (seul accès sans session à des données
  personnelles : jeton révocable / régénérable, 60 lectures / 15 min,
  `no-store`). Liens absolus construits depuis `X-Forwarded-Host` /
  `X-Forwarded-Proto` (posés par Caddy). Interdit au connecteur MCP.

## Inscriptions et comptes

`AppSettings.registrationEnabled` (Administration → Utilisateurs) ouvre ou
ferme les inscriptions libres ; `ALLOW_REGISTRATION=false` les ferme quoi
qu'il arrive (`registrationOpen()`). Les administrateurs créent des comptes
avec un mot de passe imposé et réinitialisent un mot de passe (sessions de la
personne fermées).

## Graphiques (amCharts 4)

`src/components/charts/AmChart.tsx` : enveloppe générique — import dynamique
(`@amcharts/amcharts4/core` et `/charts`), construction via un callback,
disposal au démontage / changement de dépendances, `themeColor()` pour
résoudre les variables CSS du thème. Composants : `StatusDonut` (PieChart),
`ProgressBarsChart` (XYChart, barres empilées jauge), `PlanningChart` (Gantt :
DateAxis + CategoryAxis, barre prévisionnelle claire + part réalisée pleine,
ligne « aujourd'hui », libellés français), `ProgressCurveChart` (courbe
d'avancement du voyage dans le temps), graphe des liens (extension
« force-directed », `charts/forceDirected.ts`, toujours importée avec le cœur
et les graphiques). Licence commerciale amCharts 4
(`CH214458775`, `MP214458775`) appliquée une fois par l'enveloppe
(`applyLicense`) : plus de logo amCharts. Libellés issus des utilisateurs :
`[` et `]` doublés (codes de mise en forme amCharts).

## Interface

- Tailwind CSS 4, thème dans `src/app/globals.css` (`@theme`).
- Responsive : barre latérale ≥ `md`, tiroir mobile sinon ; onglets
  défilants ; panneau de carte en tiroir bas ; curseurs d'avancement sous la
  ligne de tâche sur mobile.
- Éditeur riche partagé : `src/components/RichTextEditor.tsx` — collage
  d'image **optimiste** (aperçu blob immédiat, upload en arrière-plan,
  sauvegarde différée tant qu'une URL `blob:` est présente).
- Inventaire des écrans : docs/03-screens.md.

## Performance et gros volumes

Jeu de données conservé : `npm run perf:seed` (200 comptes, ~20 000 tâches,
projet de 4 000 tâches, carte de 5 000 nœuds, 9 000 messages, 3 000
notifications ; `SCALE=` pour l'ajuster) ; mesures : `npm run perf:bench`
(32 routes et pages, budgets indicatifs : auto-complétion < 150 ms, ouverture
< 800 ms). Règles appliquées, à respecter dans toute évolution :

- **Serveur** : filtrer et compter en base, jamais charger une collection
  entière pour filtrer en JS ; requêtes indépendantes en `Promise.all`
  (recherche) ; listes d'un tableau de bord plafonnées avec compteurs exacts.
- **Client** : pas de rendu de milliers d'éléments d'un coup — rendu
  progressif « Afficher plus » (Kanban : 50 cartes par colonne ; Synthèse :
  100 lignes ; Plan : 100 tâches par liste, étapes repliées à l'ouverture
  au-delà de 400 tâches sauf la première ; retards du tableau de bord projet :
  20), **virtualisation** verticale du Gantt au-delà de 150 lignes (lignes de
  hauteur fixe, marge de 25), carte mentale en `onlyRenderVisibleElements`
  avec **réutilisation des objets nœuds inchangés** (une sélection ne recrée
  plus les milliers de nœuds React Flow).

Mesures (build de production local, jeu complet) : tableau de bord 2,9 s →
0,1 s ; liste des projets 1 s → 40 ms ; Organiser 2,8 s / 11 Mo → 0,56 s /
3,4 Mo, blocage navigateur 1,1 s → 10 ms ; onglet Plan du projet géant 2,9 s →
0,4 s ; Gantt 1,6 s → 0,2 s ; clic sur un nœud de la carte géante 1,5 s →
50 ms ; auto-complétion ≈ 40 ms.

## Journal quotidien (`src/lib/journal.ts`, règles pures `src/lib/shared/journal.ts`)

Menu « Journal quotidien » (`/journal`, sous « Prise de notes ») : une page par
jour (calendrier de Paris) avec sept blocs rédigés en texte riche (Résumé,
Pensées positives, Pensées négatives, Réalisations, Regrets, Habitudes et
routines, Amélioration continue) et un bloc **Activité** calculé à la lecture
depuis les pistes d'audit (`TaskEvent`, `MapEvent` dont `actorId` = moi,
ce jour-là). Une saisie = `JournalEntry` (utilisateur, jour, bloc ; unique),
HTML assaini à l'écriture et à la lecture ; contenu vide = saisie supprimée ;
`mode: "append"` ajoute à la suite (connecteur MCP) ; jours futurs refusés
(au-delà de demain). **Strictement personnel** : toutes les requêtes filtrent
sur `userId`, aucune lecture administrateur ni hiérarchique ; non consolidé
dans le rapport d'activité. Blocs affichés : `User.journalBlocks`
(Préférences → Personnalisation du journal, `PATCH /me`). Rapport d'un bloc
entre deux dates (366 j max) : saisies + série quotidienne (mots, ou actions
pour Activité). Connecteur MCP : `get_journal` (période, blocs par clé ou
libellé approximatif — `resolveJournalBlock` —, activité facultative),
`write_journal` (écriture via l'API REST, ajout à la suite par défaut,
aujourd'hui par défaut) et `query_objects` (`entity: "journal_entry"`,
`status` = bloc). En ligne uniquement (relayé dans l'application).
