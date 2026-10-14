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

- E-mail + mot de passe (bcrypt coût 12). Sessions **opaques** en base
  (`Session.token`, 256 bits), 90 jours. Web : cookie `session` HTTP-only,
  `SameSite=Lax`, `Secure` en production. Mobile : même jeton en
  `Authorization: Bearer` (prioritaire sur le cookie).
- Anti-CSRF : les requêtes mutantes authentifiées par cookie doivent porter
  un `Origin` égal à l'hôte (`src/lib/api.ts`).
- Rate limiting en mémoire : `login`/`register` (10 / 15 min / IP),
  `users/lookup` (60 / 15 min / utilisateur).
- `ALLOW_REGISTRATION=false` ferme l'inscription publique ; les comptes se
  créent alors avec `scripts/create-user.ts`.
- **Projets partagés** : un projet est visible et modifiable par son
  propriétaire et par les membres de l'équipe rattachés à un compte
  (`ProjectMember.userId`). Suppression du projet et gestion de l'équipe :
  propriétaire seulement. Documents et commentaires : supprimables par leur
  auteur ou le propriétaire.

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

Client : magasin partagé `src/lib/notifications-store.ts` (un seul
rafraîchissement toutes les 60 s + au focus, partagé entre la cloche de la
barre latérale et celle de l'en-tête mobile), composant `NotificationsBell`
(compteur, panneau, clic = marquer lue + naviguer, bascule lue / non lue,
« Tout lu ») et page `/notifications`.

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
