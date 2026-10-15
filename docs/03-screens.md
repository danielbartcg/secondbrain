# Écrans et composants

Toutes les pages sont sous `src/app/(app)/` (coque authentifiée `AppShell`)
sauf connexion/inscription (`src/app/(auth)/`). UI en français, responsive.

| Route | Page serveur | Composant client principal | Rôle |
| --- | --- | --- | --- |
| `/login`, `/register` | — | formulaires | authentification (API `/auth/*`) |
| `/dashboard` | `dashboard/page.tsx` → `getDashboard` + `listMindMaps` | `dashboard/HomeDashboard` + `GlobalSearch` | tableau de bord personnel, **recherche globale** |
| `/mindmaps` | `mindmaps/page.tsx` | `mindmap/MindMapList` | liste des cartes (les miennes et celles partagées avec moi) |
| `/mindmaps/[id]` | `mindmaps/[id]/page.tsx` | `mindmap/MindMapEditor` | éditeur de carte (plein cadre) |
| `/projects` | `projects/page.tsx` | `projects/ProjectList` | liste, filtre par statut, création |
| `/projects/[id]` | `projects/[id]/page.tsx` | `projects/ProjectWorkspace` | espace projet à onglets |
| `/tasks/[taskId]` | `tasks/[taskId]/page.tsx` → `getTaskDetail` | `projects/TaskSheet` | **fiche tâche** (avec ou sans projet) + sessions + fil de commentaires ; l'ancienne adresse `/projects/[id]/tasks/[taskId]` redirige |
| `/projects/sans-projet` | `projects/sans-projet/page.tsx` → `listOrphanTasks` | `projects/OrphanTasks` | projet virtuel **« Sans projet »** : tâches orphelines (création, statut, fiche, suppression) |
| `/organize` | `organize/page.tsx` → `getMyTasks` | `organizer/TaskOrganizer` | **Mes tâches** : Synthèse / Sélection / Calendrier / Kanban (entrée de menu « Mes tâches ») |
| `/notifications` | `notifications/page.tsx` | `NotificationsPage` | toutes mes notifications (filtre non lues) |
| `/preferences` | `preferences/page.tsx` → `getProfile` | `PreferencesPage` | **Préférences** : prénom / nom, photo, mot de passe, application desktop, thème |
| `/app` | `app/page.tsx` → `latestDesktop` (public, hors coque) | — | téléchargement de l'application desktop (version, taille, empreinte), avertissement SmartScreen, iPhone « bientôt » |
| `/team` | `team/page.tsx` → `listTeamTasks` | `admin/TeamOverview` | **Mon équipe** (managers) : N-1 directs et leurs tâches, lecture seule |
| `/admin/users` | `admin/users/page.tsx` → `listUsersAdmin` | `admin/AdminUsers` | **Administration** : rôles et managers |
| `/admin/projects`, `/admin/projects/[id]` | `listAllProjectsAdmin`, `getProjectAdmin` | `admin/AdminProjects`, `admin/AdminProjectView` | tous les projets ; un projet en lecture seule |
| `/admin/tasks` | `admin/tasks/page.tsx` → `listAllTasksAdmin` | `admin/TaskOverviewTable` | toutes les tâches (recherche, filtre de statut) |
| `/notes` | `notes/page.tsx` → `children("root")` | `notes/NotesWorkspace` | **Prise de notes** : arborescence paresseuse + document riche par objet ; lien profond `?ref=kind:id` |

Pages système : `src/app/not-found.tsx` (« Page introuvable », lien vers le
tableau de bord), `src/app/(app)/error.tsx` (« Une erreur est survenue » +
« Réessayer », coque conservée), `src/app/(app)/loading.tsx` (indicateur de
chargement). `/login` et `/register` sont des composants client : leur titre
d'onglet vient de `layout.tsx` dans chaque dossier. Le `theme-color` du
navigateur mobile suit le thème de l'utilisateur (`generateViewport` du
layout racine).

## Coque (`AppShell`)

Menu complet : Tableau de bord, Cartes mentales, Projets, Mes tâches, Prise de
notes, **Mon équipe** (si l'on a des N-1), **Préférences**, puis
**Administration** en dernier (administrateurs et super administrateur). Le
pied de la barre latérale montre la photo (ou la silhouette), le nom et
l'e-mail, et mène aux Préférences.

Menu : Tableau de bord, Cartes mentales, Projets, **Mes tâches**, **Prise de
notes**. **Cloche de notifications** (`NotificationsBell`)
à côté du logo (barre latérale) et dans l'en-tête mobile : pastille rouge =
nombre de non lues ; panneau déroulant façon réseau social (icône par type,
titre, extrait, « il y a … », point bleu si non lue) ; un clic marque lue et
ouvre l'endroit concerné (fiche tâche, commentaire ciblé) ; au survol :
bascule lue / non lue, suppression ; « Tout lu » ; lien « Voir toutes ».

## Prise de notes (`notes/NotesWorkspace`)

- **Arborescence** (colonne à gauche, tiroir sur mobile) : Cartes mentales ›
  carte › nœuds › sous-nœuds… ; Projets › projet › étapes › activités › tâches,
  tâches sans étape, « Sans projet ». Chaque branche se charge **à
  l'ouverture** (chevron, indicateur de chargement) ; icône par type (cerveau,
  nœud, dossier, étape, activité, tâche), point bleu si l'élément a des
  notes, indice (statut, nombre de nœuds…).
- **Document** (droite) : type, bouton « Ouvrir l'objet », grand titre, date,
  éditeur riche plein cadre façon Notion (`RichTextEditor`, images collées) ;
  **enregistrement automatique** 800 ms après la dernière frappe, et à la
  fermeture de la page ; fil d'Ariane cliquable ; indicateur
  Enregistré / Enregistrement… / Erreur. Les sections (Cartes mentales,
  Projets, Sans projet) ne sont pas éditables.
- Les notes sont visibles sur l'objet : `NotesPreview` (projet : sous
  l'en-tête ; fiche tâche : bloc « Notes ») avec « Modifier dans Prise de
  notes », icône carnet (colorée si notes) sur chaque étape, activité et
  tâche du Plan, lien « Ouvrir dans Prise de notes » dans le panneau de
  carte. Les notes d'une carte = notes de son nœud racine.

## Mes tâches (`organizer/TaskOrganizer`)

Sélecteur de vue, dans l'ordre **Synthèse / Sélection / Calendrier / Kanban**
(mémorisé dans le hash : `#synthesis`, `#matrix`, `#calendar`, `#kanban` ;
Synthèse par défaut), compteurs, indicateur d'enregistrement. Items tâche colorés
selon la priorité (rouge critique, ambre haute, indigo moyenne, gris basse).

| Vue | Composant | Contenu |
| --- | --- | --- |
| Calendrier | `CalendarView` | liste « Tâches à planifier » (glissable ; une tâche planifiée est grisée mais reste déposable) + grille mensuelle lun→dim, navigation, aujourd'hui. Déposer sur un jour = **session de travail** ; les sessions se glissent d'un jour à l'autre, se retirent (×), sont liées à la fiche. Session après l'échéance : bordure rouge + ⚠. Drapeau rouge sur les jours d'échéance. Mobile : liste horizontale, sélection au clic puis clic sur un jour |
| Sélection | `MatrixView` | matrice **priorité** (lignes, Critique en haut → Basse) × **complexité** (colonnes Basse / Moyenne / Forte) ; glisser une carte vers une autre zone change sa complexité (et sa priorité si la ligne change) |
| Synthèse | `SynthesisView` | tableau : #, tâche, projet, étape, priorité (modifiable), échéance (rouge si dépassée), statut, « Prévu ? » (oui · n jours / non) ; glisser les lignes = ordre relatif personnel ; 100 lignes puis « Afficher plus » |
| Kanban | `KanbanView` → `tasks/KanbanBoard` | colonnes À faire / En cours / Terminée / Clôturée (repliée), cartes glissables (statut), **filtre** : Toutes mes tâches · Mes tâches de la semaine (échéances) · Mes tâches de la semaine (sessions de travail) · Mes tâches (assignation) · (supervision) · (contribution) |

## Tableau de bord personnel (`HomeDashboard`)

- **Recherche globale** (`GlobalSearch`) sous le titre : auto-complétion
  (250 ms) sur projets, tâches, nœuds de carte et cartes (titre / nom et
  description / notes), résultats groupés par type avec surlignage, ↑ ↓ Entrée
  Échap, pleine largeur sur mobile ; un clic ouvre la page dédiée (fiche
  tâche, projet, carte centrée sur le nœud).
- 4 indicateurs : mes tâches ouvertes, en retard (tâches + livrables),
  échéances sous 7 jours, avancement global.
- **Mes tâches** (affectées à un membre rattaché à mon compte), lien vers la
  fiche tâche.
- **Échéances à venir** (30 jours) : tâches et livrables de tous mes projets
  actifs, en retard en rouge, « moi » si c'est le mien.
- Graphiques amCharts 4 : mes tâches par statut (`StatusDonut`), livrables
  par statut (`StatusDonut`), avancement par projet (`ProgressBarsChart`).
- Raccourcis cartes mentales.

## Espace projet (`ProjectWorkspace`)

En-tête commun (couleur, statut, nom, description, dates, compteurs, jauge)
puis onglets, mémorisés dans le hash de l'URL (`#plan`, `#livrables`…) :

| Onglet | Composant | Contenu |
| --- | --- | --- |
| Tableau de bord | `ProjectDashboardTab` | KPIs ; **planning Gantt** (`PlanningChart`) des étapes (part réalisée en plein) et livrables 📦 avec ligne « aujourd'hui » ; avancement par étape (`ProgressBarsChart`) ; tâches par statut ; statut des livrables (anneau + liste) ; tâches en retard (20 plus anciennes, « Tout afficher ») |
| Gantt | `ProjectGanttTab` → `charts/GanttChart` | tâches planifiées dans l'ordre du plan (couleur de l'étape, avancement dans la barre), flèches prérequis → tâche (rouges et pointillées si le prérequis finit après le début), échelle **Jour / Semaine / Mois** (week-ends grisés en vue jour, barre de défilement, molette = défilement horizontal), **glisser une barre** = décaler début et échéance au jour près (case « Décaler aussi les tâches qui en dépendent », cochée par défaut), double-clic ou clic sur le nom = fiche tâche ; bandeau des conflits ; liste des tâches sans date |
| Kanban | `ProjectKanbanTab` → `tasks/KanbanBoard` | toutes les tâches du projet par statut (contexte étape › activité, responsable), glisser pour changer le statut, lien fiche ; même composant que le Kanban de « Mes tâches » ; 50 cartes par colonne puis « Afficher plus » |
| Plan | `ProjectBoard` | bloc **« Tâches sans étape »** (tâches du projet non rattachées à une étape, ajout rapide) puis étapes › activités › tâches : drapeau de priorité, avancement (curseur, envoi différé 400 ms), statut cliquable, responsable (avatar), échéance, commentaires, réordonnancement, lien fiche tâche ; détails rapides : priorité, complexité, dates, clôture ; gros projet (> 400 tâches) : étapes repliées sauf la première, 100 tâches par liste puis « Afficher plus » |
| Livrables | `DeliverablesTab` | cartes : statut, responsable, étape, début/fin attendus, documents rattachés (téléversement direct, rattachement d'un document existant, détachement, téléchargement) |
| Documents | `DocumentsTab` | **explorateur à dossiers** : fil d'Ariane, sous-dossiers du dossier courant (créer, renommer, « Déplacer vers… », supprimer → contenu remonté dans le parent), documents du dossier courant (sélecteur de dossier, « matérialise le livrable … », téléchargement, suppression par l'auteur ou le propriétaire) ; dépôt (bouton ou glisser-déposer) **dans le dossier courant** |
| Équipe | `TeamTab` | membres (avatar, rôle, couleur, nb de tâches) ; ajout en **nom libre** ou **compte de l'application** (recherche par e-mail exact) ; retrait (propriétaire uniquement, jamais le propriétaire lui-même) |

État partagé : `run(fn)` exécute une mutation API, remplace le projet par la
réponse recalculée, recharge en cas d'erreur.

## Fiche tâche (`TaskSheet`)

- Fil d'Ariane : projet (ou « Sans projet ») › étape › activité.
- **Consultation** (administrateur, manager d'un N-1, `canEdit: false`) :
  bandeau « Consultation en lecture seule », tout le contenu désactivé.
- Carte principale : badges (statut, priorité, retard, nb commentaires),
  titre éditable, boutons de statut À faire / En cours / Terminée + curseur
  d'avancement, puis des blocs titrés, dans cet ordre :
  1. **Rattachement** : Projet › Étape › Activité (voir ci-dessous) ;
  2. **Qualification** : Priorité, Complexité ;
  3. **Acteurs** : Responsable, Superviseur (un seul membre), Contributeurs
     (sélection multiple à cases à cocher, avatars) — désactivés sans projet ;
  4. **Calendrier** : Début, Échéance, **Date de clôture** (remplie
     automatiquement à la clôture, modifiable tant que la tâche est clôturée,
     grisée sinon) ;
  puis description et suppression.
- **Rattachement** : trois sélecteurs **Projet › Étape › Activité**, tous
  facultatifs (« Sans projet », « Sans étape », « Sans activité ») ; les listes
  se chargent à la demande ; changer de projet efface étape, activité et
  affectation.
- **Nœuds de carte mentale** : nœuds rattachés (lien vers la carte centrée
  sur le nœud, détachement).
- **Sessions de travail planifiées** : jours prévus (les miens retirables,
  ceux des autres membres affichés avec leur nom), ajout par sélecteur de
  date, badge et bordure rouge ⚠ pour une session après l'échéance.
- **Clôture** : une fois la tâche Terminée, un bouton violet « Clôturer »
  apparaît (statut `CLOSED`, icône cadenas) ; sur une tâche clôturée il devient
  « Clôturée » et un clic la rouvre (Terminée). Dans le Plan, l'icône de statut
  fait tourner À faire → En cours → Terminée ; la clôture se fait par le bouton
  « Clôturer » des détails rapides ou depuis la fiche.
- **Échanges** : fil **hiérarchique** : chaque commentaire a un bouton
  « Répondre » (formulaire inline, Échap annule) ; les réponses s'imbriquent
  sans limite de profondeur (indentation plafonnée au 4e niveau, bordure
  gauche), repliables (« Masquer / Afficher n réponses »). Suppression par
  l'auteur ou le propriétaire (avec ses réponses). Ancre `#comment-<id>`
  (depuis une notification) : défilement + surbrillance. Zone de saisie avec **mentions** : taper `@`
  puis des lettres filtre les membres (↑/↓, Entrée/Tab pour insérer, Échap) ;
  l'insertion écrit `@[Nom]` dans la zone de saisie (lisible, sans
  identifiant) ; le serveur résout le membre à l'envoi et le commentaire
  affiche `@Nom` en surbrillance. Ctrl+Entrée envoie.

## Éditeur de carte (`MindMapEditor`)

Voir docs/01-architecture.md § Cartes mentales. Raccourcis : Tab enfant,
Entrée frère, Suppr, F2 renommer, Espace replier, Échap. Panneau latéral
(tiroir bas sur mobile) : titre, couleur, **statut** (Ouvert / À surveiller /
Fermé, aussi dans la barre d'actions du nœud), notes riches
(`RichTextEditor`). « À surveiller » : halo ambré + œil ; « Fermé » :
hachuré, barré, masqué avec ses sous-nœuds ; bouton œil barré dans l'en-tête
« Afficher les nœuds fermés (n) », badge `✓n` sur le parent (cliquable).

**Déplacement libre** : tout nœud (racine comprise) se glisse sur le canevas ;
déposé **sur** un autre nœud il s'y rattache, déposé ailleurs sa position est
mémorisée et sa branche suit. Bouton **« Affichage optimisé »** dans
l'en-tête (actif dès qu'un nœud a été déplacé, avec leur nombre) : demande
confirmation (« Êtes-vous sûr(e) de vouloir écraser vos personnalisations liées
à la position des éléments sur le schéma ? ») puis replace tout
automatiquement et recadre.

**Tâches d'un nœud** (`NodeTasksPanel`, dans le panneau) : liste des tâches
rattachées (statut cliquable, projet ou « Sans projet », fiche, détachement),
« Nouvelle » (crée une tâche sans projet rattachée au nœud), « Existante »
(recherche puis rattachement). Indicateur visuel sur le nœud : pastille
bleue avec le nombre de tâches **non clôturées** (terminées comprises).
Arrivée par `?node=<id>` (recherche, fiche tâche) : nœud sélectionné, centré,
panneau ouvert, nœuds fermés affichés si nécessaire.

## Partage des cartes (`MindMapList`, `MindMapEditor`, `mindmap/ShareMapDialog`)

- **Liste** : une carte partagée avec moi porte une pastille violette
  (icône `Users`) sur son icône, « Partagée par <Nom> » (avatar) et un badge
  de droit **Lecture** / **Écriture** ; une carte à moi partagée avec
  d'autres affiche « Partagée avec N personne(s) ». Corbeille réservée au
  propriétaire ; sur une carte partagée, bouton **Quitter** (`LogOut`,
  confirmation) à la place. Renommage en place impossible en lecture.
  Filtres (onglets défilants, affichés dès qu'une carte m'est partagée) :
  Toutes · Les miennes · Partagées avec moi (n). Tableau de bord : petite
  icône `Users` à côté du titre d'une carte partagée.
- **Bouton « Partager »** (en-tête de l'éditeur, propriétaire seulement,
  avec le nombre de personnes) → `ShareMapDialog` : fenêtre modale
  (`role="dialog"`, Échap, clic hors cadre ; tiroir bas sur mobile) —
  choix des personnes (contacts de la messagerie `GET /messages/contacts`,
  filtrables, ou adresse e-mail exacte d'un compte via `GET
  /users/lookup`), droit **Lecture / Écriture**, « Partager » ; puis
  « Personnes ayant accès » : changement de droit (liste déroulante) et
  retrait (confirmation).
- **Bandeau** sous l'en-tête d'une carte partagée avec moi : « Lecture
  seule — carte partagée par X » (ambré, cadenas) ou « Carte partagée par
  X (écriture) ».
- **Lecture seule** (`access = "read"`) : titre non éditable, pas de
  création / renommage / suppression / glisser-déposer / statut / couleur /
  « Affichage optimisé » ; raccourcis clavier désactivés sauf Espace
  (replier / déplier **local**, non enregistré, comme « Tout replier ») ;
  panneau : titre, couleur et statut en lecture, notes affichées (HTML
  assaini) au lieu de l'éditeur, tâches listées sans « Nouvelle » /
  « Existante » / détacher. « Prise de notes » : documents non éditables.
- **Écriture** (`access = "write"`) : tout comme le propriétaire, sauf
  supprimer la carte et gérer les partages.

## Application native (`native/src`)

Mêmes écrans que le site (routeur `native/src/App.tsx`), plus :
- **Connexion** (`screens/Login.tsx`) : serveur, e-mail, mot de passe ; premier
  téléchargement des données ;
- **encart de synchronisation** (`ui/SyncPanel.tsx`, au-dessus du menu) : en
  ligne / hors ligne, modifications en attente, dernière synchro, conflits,
  bouton « Synchroniser », bascule « Hors ligne » ;
- bandeau « Des modifications sont arrivées du serveur — Actualiser » sur les
  écrans d'édition (les listes s'actualisent seules) ;
- **Conflits** (`/conflicts`, `screens/Conflicts.tsx`) : type, élément, champ,
  votre valeur / valeur retenue, « Copier ma valeur », effacer ;
- « Disponible uniquement en ligne » pour les écrans relayés au serveur ;
- « Mise à jour nécessaire » (bloquant) quand le serveur répond 426.

## Messagerie (`/messages`, `/messages/:id` — `messages/MessagesApp`)

Plein cadre : liste des conversations (recherche, aperçu du dernier message,
pastille du nombre de non lus, avatar ou double avatar de groupe) et fil, en
deux colonnes sur grand écran, l'un **ou** l'autre sur mobile (retour ←).
Fil : séparateurs de jour, « Nouveaux messages », bulles (les miennes à
droite), messages regroupés par auteur sur 5 min, citation de la réponse
(cliquable : défilement + surbrillance), actions Répondre / Supprimer (survol
à la souris, toujours visibles au toucher), coches ✓ envoyé / ✓✓ vu et « Vu »,
« Vu par … » ou « Non vu » sous mon dernier message, « Messages précédents ».
Menu « … » : Marquer comme non lu, Quitter la conversation. Saisie :
`RichTextEditor` compact (gras, italique, liste, **emoji**, image), Ctrl +
Entrée pour envoyer, bandeau « Réponse à … » annulable. « Nouveau » : boîte
de dialogue (contacts à cocher, ajout par e-mail exact, titre si groupe,
premier message). Menu : entrée **Messages** avec badge de non lus ; sur
mobile, icône Messages à côté de la cloche.

## Emoji (`EmojiPicker.tsx`)

`EmojiButton` : sélecteur emoji-mart (données et libellés français
embarqués, emoji natifs, chargé à la première ouverture, compatible CSP et
hors ligne) ; ancré sous le bouton sur grand écran, en bas de l'écran sur
mobile ; Échap / clic extérieur ferment. Présent dans **tous** les éditeurs :
barre d'outils de `RichTextEditor` (notes, cartes, messagerie) et zone de
commentaire des tâches (insertion au curseur).

## Écrans de compte publics (`(auth)`, `AuthFrame`)

- `/login` : lien « Mot de passe oublié ? » **uniquement si l'envoi d'e-mails
  est configuré** (`GET /auth/options`) ; « Créer un compte » masqué si les
  inscriptions sont fermées ; lien discret « Télécharger l'app pour Windows »
  sous le formulaire.
- `/forgot-password` (adresse ; réponse identique que le compte existe ou
  non), `/reset-password?token=` (nouveau mot de passe + confirmation),
  `/verify-email?token=` (validation automatique, puis « Ouvrir Second Brain »).

## Télécharger l'app (`DesktopAppPromo`)

Carte d'invitation sur le tableau de bord (sous la recherche) : affichée
seulement sur le site, sous Windows, masquable définitivement (✕, mémorisé
dans le navigateur). Également : lien sous le formulaire de connexion,
section « Application desktop » des Préférences. Jamais dans le menu latéral.

## Épingles (`PinButton`, menu de gauche)

Bouton punaise « Épingler dans le menu » / « Désépingler » : cartes de la
liste des projets et des cartes mentales, en-tête de la fiche projet
(« Épinglé ») et de l'éditeur de carte. Les éléments épinglés apparaissent
en retrait, sous « Projets » / « Cartes mentales » (pastille de couleur,
élément courant surligné). La barre latérale ne défile plus elle-même : seul
le menu défile, et elle passe au-dessus du contenu (panneau des
notifications visible en entier, plus de barre de défilement parasite).

## Fiche tâche : prérequis (`projects/PrerequisitesField`)

Dans le bloc Calendrier : prérequis listés (statut, échéance, alerte
« finit après le début » ou « non terminé »), retrait ✕, ajout par liste
déroulante limitée aux tâches du projet qui ne créent pas de cycle, et
rappel « Bloque : … » des tâches qui en dépendent.

## Mot de passe : jauge (`PasswordStrengthMeter`)

Jauge 3 segments **Faible / Moyenne / Élevée** + conseil
(`src/lib/shared/password.ts` : longueur, variété, mots de passe courants,
répétitions, suites, nom / e-mail) : inscription (avec **confirmation** du
mot de passe), réinitialisation, changement dans les Préférences. Indicative.

## Préférences (`PreferencesPage`)

- **Identité** : photo (ajouter / changer / retirer ; sinon silhouette),
  prénom, nom, aperçu du nom affiché, identifiant et rôle.
- **Mot de passe** : actuel, nouveau (8 caractères min., différent de
  l'actuel), confirmation, contrôles en direct ; après changement, les autres
  sessions (autres appareils) sont déconnectées.
- **Thème** : 5 vignettes (Clair, Sombre, Sépia, Océan, Forêt), appliqué
  immédiatement et mémorisé sur le compte.

Sections ajoutées (`preferences/AccountSections.tsx`) : **Adresse e-mail**
(adresse, pastille Validée / Non validée, « Envoyer le lien de validation »
si l'envoi est configuré, « Changer d'adresse » avec mot de passe actuel,
interrupteur « Recevoir les notifications par e-mail ») et **Connecteur
Claude (MCP)** (création de clés nommées, case « Autoriser les modifications »
cochée par défaut, pastille Lecture et écriture / Lecture seule, clé affichée une seule fois avec la
configuration Claude Desktop et la commande Claude Code à copier, liste avec
dernière utilisation, révocation).

## Administration (`/admin`, `admin/*`)

Onglets Utilisateurs · Tous les projets · Toutes les tâches.
- **Utilisateurs** : recherche ; par compte, rôle (Utilisateur / Administrateur ;
  « Super administrateur » figé ; pas de modification de son propre rôle),
  manager (N+1) dans une liste, N-1 en avatars, nombre de projets.
- **Tous les projets** : tableau (propriétaire, statut, avancement, équipe,
  tâches) ; un projet s'ouvre en lecture seule (équipe, étapes › activités ›
  tâches, liens vers les fiches en consultation).
- **Toutes les tâches** : `TaskOverviewTable` (recherche texte, filtre
  Ouvertes / Toutes / par statut, responsable, superviseur, contributeurs).

## Mon équipe (`admin/TeamOverview`)

Puces des N-1 (photo, nom, nombre de tâches ouvertes ; clic = filtre) et
`TaskOverviewTable` de leurs tâches ; les fiches s'ouvrent en lecture seule.

## Composants partagés (`src/components/ui.tsx`)

`PageHeader`, `Button`, `ProgressBar`, `InlineEdit` (clic, ou Entrée / Espace
au clavier, pour éditer ; `role="button"`), `QuickAdd` (en cas d'erreur, la
saisie est conservée et un toast s'affiche), `EmptyState`, `Avatar` (photo `src`
sinon silhouette sur couleur stable par id),
`Badge`, `PriorityFlag`, constantes de libellés/couleurs (`TASK_STATUS_*`,
`DELIVERABLE_STATUS_*`, `PRIORITY_*` dont `PRIORITY_CHIP`, `COMPLEXITY_*`,
`NODE_STATUS_LABEL`), helpers `formatDate`, `formatBytes`, `relativeDays`,
`ymd` / `todayYmd` (jour local `AAAA-MM-JJ`).

- **`toast(message, "error" | "ok")`** : message éphémère (4 s) sans
  fournisseur React, `role="status"` ; remplace `alert()` pour les erreurs.
  `errorMessage(e, repli)` extrait le message d'une `ApiClientError`.
- `selectClass` / `inputClass` / `selectClassXs` : texte 16 px sur mobile
  (`text-base sm:text-sm` / `sm:text-xs`) pour éviter le zoom automatique
  d'iOS — toute nouvelle saisie doit respecter ce minimum.
- Couleurs : uniquement des jetons du thème (`surface`, `line`, `ink`,
  `muted`, `brand-50/100/500/600/700`, `ok`, `warn`, `danger`…) ou les teintes
  redéfinies en thème sombre (`red-50…800`, `amber-50…900`, `violet-50/200/700`,
  etc., cf. `globals.css`). Pas de `brand-300/400`, pas de `bg-white`.
- Menus et tiroirs : fermeture au clic extérieur et sur Échap ; tiroirs
  mobiles `role="dialog"`. Cibles tactiles ≥ 32 px sur mobile
  (`p-2 md:p-1`…).

## Graphiques (`src/components/charts/`)

`AmChart` (enveloppe amCharts 4), `StatusDonut`, `ProgressBarsChart`,
`PlanningChart`. Règle : tout nouveau graphique = nouveau composant dans ce
dossier, construit avec amCharts 4.

## Fiche projet : nouveaux onglets et export

- **Gantt** (`ProjectGanttTab` → `src/components/gantt/GanttView.tsx`, composant dédié HTML/CSS + SVG ; logique pure `ganttModel.ts`, `npm run test:gantt`) : grille gauche figée (Nom, Début, Fin, Durée, % — Début / Fin / Durée masquées sur mobile), hiérarchie repliable **étape › activité › tâche**, puis « Sans étape » ; frise à en-tête double (mois / jours, mois / semaines « S42 », années / mois), week-ends grisés, ligne « Aujourd'hui » ; barres couleur de l'étape avec avancement, contour rouge en cas de conflit ; barres de synthèse en crochet pour étapes et activités ; **flèches fin → début à angles droits** (contournement si la tâche commence juste après, rouges pointillées en conflit, mises en évidence au survol). **Glisser le milieu** d'une barre = la déplacer, **glisser un bord** = changer le début ou la fin, au jour près, aperçu en direct et infobulle ; clavier : ←/→ déplacer, Maj+←/→ fin, Ctrl+←/→ début, Entrée ouvrir ; double-clic ou clic sur le nom = fiche tâche. Option « Décaler aussi les tâches qui en dépendent ». Tout déplier / replier, « Aujourd'hui ». Tâches sans date listées à part. Échelles 32 / 16 / 5 px par jour. Au-delà de 150 lignes, seules les lignes visibles sont rendues (virtualisation).
- **Réunions** (`ProjectMeetingsTab`) : liste (date, statut Brouillon / Sans validation / En validation / Validé / Refusé, « À valider par vous ») et détail (deux colonnes ; l'un ou l'autre sur mobile). Création : titre, date et heure, lieu, participants, validateurs (membres avec compte). Détail : champs modifiables par le rédacteur ou le propriétaire, participants, validateurs avec leur décision et leur motif, **compte-rendu** en texte riche (tableaux, images, emoji) enregistré automatiquement (1,2 s) avec avertissement « modifier annule les validations ». Panneau du validateur : « Valider » / « Refuser… » (motif obligatoire). Ouverture directe depuis une notification (`?meeting=<id>#reunions`).
- **Risques** (`ProjectRisksTab`) : Risques | Opportunités (compteurs) ; matrice 5 × 5 (`risks/RiskMatrix.tsx`) probabilité (5 Quasi certain → 1 Rare) × gravité (Négligeable → Critique) ou bénéfice (Faible → Majeur), couleurs fixes vert → rouge (risques) et sarcelle (opportunités), case = criticité, nombre et références R1 / O1 des éléments non clos ; clic case = filtre, clic référence = met la ligne en évidence ; légende. Synthèse (par niveau, statut, échéances dépassées, sans responsable). Ajout rapide. Tableau déclaratif (cartes sur mobile) : réf., titre, catégorie, probabilité, gravité / bénéfice, criticité, statut, responsable, échéance, tâches liées (« Lier des tâches » : `risks/TaskLinkPicker.tsx`, recherche Étape › Activité › Tâche), suppression ; détail dépliable (nature, description, plan). Tri criticité / réf. / échéance, « Masquer les clos ». Optimiste avec retour arrière.
- **Documents** : glisser-déposer des documents (ou de la sélection) et des dossiers sur une tuile de dossier ou un segment du fil d'Ariane (« Documents » = racine) ; sélection multiple (cases, Ctrl/⌘-clic, Maj-clic) ; alternative « Déplacer vers… » arborescente ; la zone de dépôt ne téléverse que des fichiers venant du système. Sur mobile, les listes passent sous le nom.
- **Export Excel** : bouton en tête de fiche projet (à côté de « Épingler »), télécharge le classeur complet (`/api/v1/projects/:id/export`).

## Fiche tâche : historique (`projects/TaskHistory`)

Section repliable « Historique des modifications » en bas de la fiche :
entrées groupées par jour, la plus récente d'abord (avatar, message, heure),
filtres Tout / Modifications / Personnes / Commentaires. Rechargée quand la
tâche change. `MemberMultiSelect` est désormais un composant partagé
(`projects/MemberMultiSelect.tsx`).

## Texte riche : tableaux

Bouton « ▦ Tableau » (3 × 3 avec ligne d'en-tête) dans la barre de
`RichTextEditor` (variante complète) ; dans un tableau, barre contextuelle
« + Ligne / + Colonne / − Ligne / − Colonne / En-tête / Fusionner / Supprimer
le tableau ». Tab passe à la cellule suivante. Rendu : bordures fines,
en-tête sur fond `surface-2`, défilement horizontal si large.

## Administration → Utilisateurs

- Encart **Inscriptions libres** (`AdminRegistrationToggle`) : interrupteur ouvert / fermé (mention si `ALLOW_REGISTRATION=false` force la fermeture). Fermées : « Créer un compte » disparaît de la connexion et `/register` l'explique.
- **Créer un compte** : prénom, nom, e-mail, mot de passe (afficher / masquer, « Générer » 20 caractères, « Copier », jauge), rôle, manager ; rappel de transmettre le mot de passe par un canal sûr. Par ligne : **Réinitialiser le mot de passe** (ferme toutes les sessions de la personne) — absent sur sa propre ligne et sur le super administrateur (sauf lui-même).

## Application desktop : mise à jour

Bandeau « Nouvelle version x.y.z disponible — Mettre à jour / Plus tard »
(`native/src/ui/UpdateBanner.tsx`) : synchronise, avertit s'il reste des
modifications en attente, affiche la progression du téléchargement puis
« Installation… l'application va redémarrer ». Préférences → Application
desktop : « Rechercher une mise à jour ».
