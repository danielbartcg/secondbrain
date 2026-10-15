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
  React) — réutilisable dans l'application mobile. Rendu React Flow.
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
(administrateurs). Un **administrateur** n'accède aux projets et tâches des
autres que s'il le demande **explicitement** (`admin_access: true`) ; sans ce
drapeau, son périmètre est le sien. Protection « DNS rebinding » (en-tête
`Origin` étranger refusé), 600 requêtes / 15 min / compte. Claude Desktop s'y
connecte via `mcp-remote` (configuration générée dans les Préférences) ;
Claude Code via `claude mcp add --transport http`.

## Tableau de bord personnel (`src/lib/dashboard.ts`)

Agrège, pour les projets actifs / en pause accessibles : mes tâches
(`isMyTask`), échéances (tâches non terminées et livrables
non livrés, sous un horizon de 30 jours, retards inclus), répartitions par
statut, avancement global. Exposé par `GET /api/v1/dashboard` pour le mobile.

## Fichiers

| Usage | Répertoire | Service | Accès |
| --- | --- | --- | --- |
| Images collées dans les notes | `DATA_DIR/uploads/AAAA/MM/` | `/media/[...path]` | public, URL non devinable (128 bits), cache 1 an |
| Documents de projet | `DATA_DIR/documents/<projectId>/` | `/api/v1/documents/:id/download` | authentifié, accès projet vérifié |

Règles communes (`src/lib/uploads.ts`) : allowlist MIME, taille bornée
(10 Mo images, 25 Mo documents), nom aléatoire, pas de SVG, chemin borné au
répertoire racine. Les deux répertoires sont montés en volume Docker et
inclus dans les sauvegardes. Caddy accepte 30 Mo de corps de requête.

## Graphiques (amCharts 4)

`src/components/charts/AmChart.tsx` : enveloppe générique — import dynamique
(`@amcharts/amcharts4/core` et `/charts`), construction via un callback,
disposal au démontage / changement de dépendances, `themeColor()` pour
résoudre les variables CSS du thème. Composants : `StatusDonut` (PieChart),
`ProgressBarsChart` (XYChart, barres empilées jauge), `PlanningChart` (Gantt :
DateAxis + CategoryAxis, barre prévisionnelle claire + part réalisée pleine,
ligne « aujourd'hui », libellés français). Licence gratuite : le logo
amCharts reste affiché.

## Interface

- Tailwind CSS 4, thème dans `src/app/globals.css` (`@theme`).
- Responsive : barre latérale ≥ `md`, tiroir mobile sinon ; onglets
  défilants ; panneau de carte en tiroir bas ; curseurs d'avancement sous la
  ligne de tâche sur mobile.
- Éditeur riche partagé : `src/components/RichTextEditor.tsx` — collage
  d'image **optimiste** (aperçu blob immédiat, upload en arrière-plan,
  sauvegarde différée tant qu'une URL `blob:` est présente).
- Inventaire des écrans : docs/03-screens.md.
