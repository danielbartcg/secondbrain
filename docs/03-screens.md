# Écrans et composants

Toutes les pages sont sous `src/app/(app)/` (coque authentifiée `AppShell`)
sauf connexion/inscription (`src/app/(auth)/`). UI en français, responsive.

| Route | Page serveur | Composant client principal | Rôle |
| --- | --- | --- | --- |
| `/login`, `/register` | — | formulaires | authentification (API `/auth/*`) |
| `/dashboard` | `dashboard/page.tsx` → `getDashboard` + `listMindMaps` | `dashboard/HomeDashboard` + `GlobalSearch` | tableau de bord personnel, **recherche globale** |
| `/mindmaps` | `mindmaps/page.tsx` | `mindmap/MindMapList` | liste des cartes (les miennes et celles partagées avec moi) |
| `/mindmaps/[id]` | `mindmaps/[id]/page.tsx` | `mindmap/MindMapEditor` | éditeur de carte (plein cadre) |
| `/projects` | `projects/page.tsx` | `projects/ProjectList` | liste groupée par type de projet, filtre par statut, création, gestion des types |
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

Bouton **Actualiser** (barre latérale et tiroir : sous le profil, au-dessus de
« Se déconnecter », pour laisser le titre entier ; barre mobile : icône à côté
des notifications) : recharge la page sur le site ; dans
l'application, synchronise puis réaffiche l'écran. Épingles : icône du
projet / de la carte (sinon pastille de couleur), dans l'ordre personnel.

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

Sous « Projets » : mes **types de projet** d'abord (dossiers `ptype:<id>`,
icône étiquettes, nombre de projets), puis les projets sans type, puis
« Sans projet ». Projets et cartes avec leur icône.

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
puis onglets, mémorisés dans le hash de l'URL (`#plan`, `#livrables`…) ;
libellés courts (« Vue globale », « Historique ») tenant sur une ligne sur un écran courant ; défilement horizontal sur mobile, retour à la ligne
à partir de `md` :

| Onglet | Composant | Contenu |
| --- | --- | --- |
| Vue globale | `ProjectDashboardTab` | KPIs ; **planning Gantt** (`PlanningChart`) des étapes (part réalisée en plein) et livrables 📦 avec ligne « aujourd'hui » ; avancement par étape (`ProgressBarsChart`) ; tâches par statut ; statut des livrables (anneau + liste) ; tâches en retard (20 plus anciennes, « Tout afficher ») |
| Gantt | `ProjectGanttTab` → `charts/GanttChart` | tâches planifiées dans l'ordre du plan (couleur de l'étape, avancement dans la barre), flèches prérequis → tâche (rouges et pointillées si le prérequis finit après le début), échelle **Jour / Semaine / Mois** (week-ends grisés en vue jour, barre de défilement, molette = défilement horizontal), **glisser une barre** = décaler début et échéance au jour près (case « Décaler aussi les tâches qui en dépendent », cochée par défaut), double-clic ou clic sur le nom = fiche tâche ; bandeau des conflits ; liste des tâches sans date |
| Kanban | `ProjectKanbanTab` → `tasks/KanbanBoard` | toutes les tâches du projet par statut (contexte étape › activité, responsable), glisser pour changer le statut, lien fiche ; même composant que le Kanban de « Mes tâches » ; 50 cartes par colonne puis « Afficher plus » |
| Plan | `ProjectBoard` | bloc **« Tâches sans étape »** (tâches du projet non rattachées à une étape, ajout rapide) puis étapes › activités › tâches : drapeau de priorité, avancement (curseur, envoi différé 400 ms), statut cliquable, responsable (avatar), échéance, commentaires, réordonnancement, lien fiche tâche ; détails rapides : priorité, complexité, dates, clôture ; gros projet (> 400 tâches) : étapes repliées sauf la première, 100 tâches par liste puis « Afficher plus » |
| Livrables | `DeliverablesTab` | cartes : statut, responsable, étape, début/fin attendus, documents rattachés (téléversement direct, rattachement d'un document existant, détachement, téléchargement) |
| Documents | `DocumentsTab` | **explorateur à dossiers** : fil d'Ariane, sous-dossiers du dossier courant (créer, renommer, « Déplacer vers… », supprimer → contenu remonté dans le parent), documents du dossier courant (sélecteur de dossier, « matérialise le livrable … », téléchargement, suppression par l'auteur ou le propriétaire) ; dépôt (bouton ou glisser-déposer) **dans le dossier courant** |
| Équipe | `TeamTab` | membres (avatar, rôle, couleur, nb de tâches) ; ajout en **nom libre** ou **compte de l'application** (recherche par e-mail exact) ; retrait (propriétaire uniquement, jamais le propriétaire lui-même) |

État partagé : `run(fn)` exécute une mutation API, remplace le projet par la
réponse recalculée, recharge en cas d'erreur.

## Fiche tâche (`TaskSheet`)

**Description** riche (`RichDescription` : éditeur compact, enregistrement
automatique 800 ms, consultation seule sans droit d'écriture) — aussi dans
les détails rapides du plan (`ProjectBoard`). **Commentaires** riches :
éditeur compact avec mentions « @ » (menu des membres, ↑ ↓ Entrée), emoji,
images collées, Ctrl+Entrée pour envoyer ; corps affiché en HTML assaini avec
pastilles « @Nom ». **Pièces jointes** : bouton « Joindre » du composer
(fichiers en attente retirables, envoyés juste après le commentaire ; un
commentaire peut ne contenir que des fichiers) ; sous chaque commentaire,
puces nom · taille · aperçu (images, PDF, texte, HTML) · téléchargement ·
retrait (`components/Attachments.tsx`).

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

Panneau du nœud : bloc **Pièces jointes** (`mindmap/NodeAttachments`) sous
les notes — « Joindre » ou glisser des fichiers sur le bloc, liste avec
aperçu / téléchargement / retrait (carte modifiable), lecture seule sinon.

Nœuds plus hauts (54 px, racine 68 px) : le titre tient sur **deux lignes**
(points de suspension au-delà ; largeur estimée par `estimateWidth`). Icône
de la carte à gauche du titre (cliquable : bibliothèque d'icônes).

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

**iPhone (PWA)** : `IosInstallHint` sur le tableau de bord (iPhone / iPad dans
Safari, site non installé, masquable) : « touchez Partager puis « Sur l'écran
d'accueil » ». Page `/app` « Second Brain sur vos appareils » : Windows
(installateur) et iPhone (3 étapes d'installation sur l'écran d'accueil).
Lien de connexion : « Applications Windows et iPhone ».

## Types de projet (`projects/ProjectList`, menu de gauche)

- Bouton **« Types de projet »** de l'en-tête : explication et ajout d'un type.
- Liste : projets **sans type tout en haut** (sans cadre), puis **une carte
  par type** (ordre choisi) : poignée (glisser le type avant un autre ;
  souris), nom modifiable en place, nombre de projets, monter / descendre,
  supprimer (confirmation ; projets remis sans type) ; type vide : zone
  « Glissez un projet ici ».
- Glisser-déposer (souris) d'une carte de projet vers un autre type, ou vers
  le haut (« Déposer ici pour retirer le type ») ; au doigt et au clavier :
  sélecteur **« Type »** au pied de chaque carte de projet. « Sans projet »
  reste à part (non rangeable). Modifications optimistes, annulées en cas
  d'erreur.
- Menu de gauche : au-delà de **5 projets épinglés**, ils sont groupés par
  type (sans type d'abord, puis un intitulé par type).
- Application native : mêmes écrans ; dernière valeur connue hors ligne.

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

**Personnalisation du journal** (`preferences/FeatureSections.tsx`,
`JournalSection`, ancre `#journal`) : un interrupteur par bloc du journal
(libellé et aide), enregistré à chaque bascule (`PATCH /me`).

Sections ajoutées (`preferences/AccountSections.tsx`) : **Adresse e-mail**
(adresse, pastille Validée / Non validée, « Envoyer le lien de validation »
si l'envoi est configuré, « Changer d'adresse » avec mot de passe actuel,
interrupteur « Recevoir les notifications par e-mail ») et **Connecteur
Claude (MCP)** (création de clés nommées, case « Autoriser les modifications »
cochée par défaut, pastille Lecture et écriture / Lecture seule, clé affichée une seule fois avec la
configuration Claude Desktop et la commande Claude Code à copier, liste avec
dernière utilisation, révocation).

## Administration (`/admin`, `admin/*`)

Onglets Utilisateurs · Tous les projets · Toutes les tâches · Champs personnalisés · Notifications.
- **Champs personnalisés** (`admin/AdminCustomFields`) : ajout (libellé, liste
  de valeurs ou texte libre) ; par champ : libellé modifiable, type, nombre de
  projets renseignés, monter / descendre, archiver / réactiver, supprimer
  (confirmation avec le nombre de projets touchés) ; liste : gestionnaire de
  valeurs (`OptionsManager`) — tri « Ordre manuel · A → Z · Z → A » (tri
  forcé : valeurs rangées, nouvelles valeurs insérées à leur place),
  lignes numérotées avec poignée de glisser-déposer (pointeur : souris et
  tactile ; glisser alors qu'un tri est forcé repasse en ordre manuel),
  monter / descendre (clavier), renommage en place, nombre de projets par
  valeur, retrait (confirmation si utilisée), filtre au-delà de 8 valeurs
  (suspend le glisser-déposer), ajout unitaire ou « Ajout en masse » (une
  valeur par ligne, doublons ignorés). Fiche projet : bloc « Informations » sous les dates
  (`projects/ProjectCustomFields` : liste déroulante ou texte enregistré à la
  sortie) ; liste des projets et vue d'administration : pastilles
  « Libellé : valeur ».
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

`MentionText` (`src/components/MentionText.tsx`) : texte de piste d'audit
ou de notification dont les mentions `@[Nom](id)` s'affichent en pastille
« @Nom », comme dans le fil de commentaires (jamais l'identifiant).

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
`PlanningChart`, `DailyActivityChart`, `ProgressCurveChart` (voyage dans le
temps) ; `forceDirected.ts` charge l'extension « force-directed » (graphe des
liens) avec le cœur. Règle : tout nouveau graphique = nouveau composant dans ce
dossier, construit avec amCharts 4.

## Fiche projet : nouveaux onglets et export

- **Gantt** (`ProjectGanttTab` → `src/components/gantt/GanttView.tsx`, composant dédié HTML/CSS + SVG ; logique pure `ganttModel.ts`, `npm run test:gantt`) : grille gauche figée (Nom, Début, Fin, Durée, % — Début / Fin / Durée masquées sur mobile), hiérarchie repliable **étape › activité › tâche**, puis « Sans étape » ; frise à en-tête double (mois / jours, mois / semaines « S42 », années / mois), week-ends grisés, ligne « Aujourd'hui » ; barres couleur de l'étape avec avancement, contour rouge en cas de conflit ; barres de synthèse en crochet pour étapes et activités ; **flèches fin → début à angles droits** (contournement si la tâche commence juste après, rouges pointillées en conflit, mises en évidence au survol). **Glisser le milieu** d'une barre = la déplacer, **glisser un bord** = changer le début ou la fin, au jour près, aperçu en direct et infobulle ; clavier : ←/→ déplacer, Maj+←/→ fin, Ctrl+←/→ début, Entrée ouvrir ; double-clic ou clic sur le nom = fiche tâche. Option « Décaler aussi les tâches qui en dépendent ». Tout déplier / replier, « Aujourd'hui ». Tâches sans date listées à part. Échelles 32 / 16 / 5 px par jour. Au-delà de 150 lignes, seules les lignes visibles sont rendues (virtualisation).
- **Réunions** (`ProjectMeetingsTab`) : liste (date, statut Brouillon / Sans validation / En validation / Validé / Refusé, « À valider par vous ») et détail (deux colonnes ; l'un ou l'autre sur mobile). Création : titre, date et heure, lieu, participants, validateurs (membres avec compte). Détail : champs modifiables par le rédacteur ou le propriétaire, participants, validateurs avec leur décision et leur motif, **compte-rendu** en texte riche (tableaux, images, emoji) enregistré automatiquement (1,2 s) avec avertissement « modifier annule les validations ». Panneau du validateur : « Valider » / « Refuser… » (motif obligatoire). Ouverture directe depuis une notification (`?meeting=<id>#reunions`).
- **Risques** (`ProjectRisksTab`) : Risques | Opportunités (compteurs) ; matrice 5 × 5 (`risks/RiskMatrix.tsx`) probabilité (5 Quasi certain → 1 Rare) × gravité (Négligeable → Critique) ou bénéfice (Faible → Majeur), couleurs fixes vert → rouge (risques) et sarcelle (opportunités), case = criticité, nombre et références R1 / O1 des éléments non clos ; clic case = filtre, clic référence = met la ligne en évidence ; légende. Synthèse (par niveau, statut, sans stratégie, sans responsable). Ajout rapide. Tableau déclaratif (cartes sur mobile) : réf., titre, catégorie, probabilité, gravité / bénéfice, criticité, statut, responsable, tâches liées (« Lier des tâches » : `risks/TaskLinkPicker.tsx`, recherche Étape › Activité › Tâche), suppression ; détail dépliable (catégorie, nature, **stratégie de gestion** — Accepter et surveiller · Atténuer · Transférer · Éliminer — ou **de maximisation** pour une opportunité — Accepter et surveiller · Améliorer · Partager · Exploiter —, description, plan). Tri criticité / réf., « Masquer les clos ». Optimiste avec retour arrière.
- **Documents** : glisser-déposer des documents (ou de la sélection) et des dossiers sur une tuile de dossier ou un segment du fil d'Ariane (« Documents » = racine) ; sélection multiple (cases, Ctrl/⌘-clic, Maj-clic) ; alternative « Déplacer vers… » arborescente ; la zone de dépôt ne téléverse que des fichiers venant du système. Sur mobile, les listes passent sous le nom.
- **Export Excel** : bouton en tête de fiche projet (à côté de « Épingler »), télécharge le classeur complet (`/api/v1/projects/:id/export`).
- **Export PowerPoint** (icône `Presentation`, à côté d'« Export Excel » ; libellés masqués sur mobile, icônes seules) : télécharge la présentation « état des lieux » (`/api/v1/projects/:id/export-pptx`) avec des encadrés jaunes « Cliquez pour commenter » à compléter par le chef de projet. Les deux boutons sont masqués pour un projet type.

## Modèles (`/admin/templates` — `admin/AdminTemplates`, `templates/TemplatePicker`)

Administration → Modèles : « Projets types » et « Cartes types » (nom,
contenu résumé, « Modifier » ouvre l'écran habituel en mode modèle,
suppression) ; création « Vierge » ou « Copier » un projet / une carte /
un modèle existant. Mode modèle : bandeau violet « Projet type (modèle) » /
« Carte type », retour vers « Modèles ». Création d'un projet ou d'une carte :
liste « Partir de » (Feuille blanche ou modèle, avec son contenu) dans le
formulaire. Projet vide (propriétaire) / carte réduite à sa racine : bandeau
« Ce projet est vide » / « Cette carte est vide » avec choix du modèle et
« Appliquer le modèle ».

## Activité (`/activity` — `activity/ActivityView`)

Entrée « Activité » du menu. Période : puces (Aujourd'hui, Hier, 7 derniers
jours, Cette semaine, Semaine dernière, 30 derniers jours, Ce mois-ci, Mois
dernier, 90 derniers jours) ou « Dates libres » (du / au) ; filtres Projet /
Carte mentale ; administrateurs : « Toute la plateforme ». Indicateurs
(tâches créées, terminées / clôturées, replanifications, commentaires,
nœuds, réunions, risques, livrables / documents), activité par jour
(`charts/DailyActivityChart`, amCharts, colonnes empilées tâches / cartes /
autres), personnes actives. Puis une carte par projet (dépliable ; puces de
compteurs ; tâches avec statut et derniers messages d'audit, « Voir les N
modifications » ; réunions, risques, livrables, documents ; « Nouveau projet »)
et par carte mentale (événements de la carte, nœuds — barrés si supprimés —
avec liens `?node=`). Application : même écran, en ligne.

## Éditeur de carte : historique (`mindmap/MapHistoryPanel`)

Bouton « Historique » de la barre de la carte (lecteurs compris) : panneau
latéral (tiroir bas sur mobile), portée « Toute la carte » / « Nœud
sélectionné », filtres Tout · Nœuds · Notes · Tâches · Carte et partages,
regroupé par jour ; clic sur une entrée = sélection du nœud s'il existe
encore ; Échap ferme. Rechargé après chaque série d'enregistrements.

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

## Second cerveau : liens, fraîcheur, résurgence, référence, voyage dans le temps, iCal

- **Liens `[[…]]`** (`WikiLinks.tsx`, branché dans `RichTextEditor` : notes,
  comptes-rendus, messages) : taper `[[` ouvre une liste flottante (portail,
  `/links/suggest`, 150 ms) d'objets — tâches, projets, nœuds, cartes,
  réunions, étapes, activités, documents — filtrée au fil de la frappe ;
  ↑ ↓ Entrée / Tab, Échap ferme. Le lien inséré est une pastille teintée
  (`a[data-ref]`, `globals.css`). Dans un éditeur : Ctrl / ⌘ + clic l'ouvre ;
  ailleurs (aperçus de notes) : clic = navigation interne sans rechargement
  (écouteur de `AppShell`, site et application), Ctrl / ⌘ + clic = nouvel
  onglet.
- **« Mentionné dans »** (`Backlinks.tsx`) : objets dont les notes lient
  l'objet, avec extrait autour du lien ; sur la fiche projet (sous les
  notes), la fiche tâche (avant l'historique), le panneau d'un nœud de carte
  et chaque document de Prise de notes. Masqué s'il est vide ou hors ligne,
  et en mode modèle.
- **Graphe des liens** (`/graph`, `graph/KnowledgeGraph.tsx`, entrée de
  menu) : amCharts 4 « force-directed » (`charts/forceDirected.ts`, chargé à
  la demande avec le cœur), couleur par type, taille selon le nombre de
  liens, clic = ouvrir l'objet ; périmètre (projet ou carte : ses objets et
  leurs voisins), types affichables / masquables, « Les plus reliés ».
- **Tableau de bord** : « Endormis » (`dashboard/StalePanel.tsx` : projets
  actifs en pastilles, 8 tâches avec leurs jours d'inactivité, lien « Régler
  le seuil ») et « À relire aujourd'hui » (`dashboard/ResurfacePanel.tsx` :
  3 notes au plus, type et boîte, extrait, « Toujours utile » / « À revoir
  bientôt » / « Ne plus proposer » ; « C'est tout pour aujourd'hui »).
- **Tableau de bord — matrice des risques** (`dashboard/RisksPanel.tsx`, tout
  en bas, pleine largeur) : même matrice 5 × 5 que l'onglet Risques
  (`RiskMatrix`, références R1, R2… par criticité décroissante), synthèse
  par niveau et registre (référence, titre, projet, statut, responsable en
  vue projets, criticité ; clic = registre du projet `#risques`). Composant
  partagé `projects/risks/RiskBoard.tsx` (matrice + synthèse + registre),
  aussi utilisé par le voyage dans le temps. Bascule
  « Risques dont je suis propriétaire » / « Tous les risques de mes
  projets », mémorisée sur l'appareil, affichée seulement si je possède au
  moins un projet actif. Risques non clos des projets actifs ou en pause ;
  masqué si le serveur est injoignable (application hors ligne).
- **Plan du projet** : pastille ambrée lune « N j » sur les tâches ouvertes
  endormies (`ProjectBoard`, contexte `StaleContext`) ; **liste des
  projets** : pastille « Endormi · N j ».
- **Gantt — planning de référence** (`projects/BaselineControls.tsx`) :
  choix de la référence (la plus récente par défaut, « Aucun »), « Figer le
  planning actuel » (nom proposé « Référence du JJ/MM/AAAA »), suppression
  (auteur ou propriétaire) ; synthèse (fin du projet, tâches en retard / en
  avance, ajoutées, retirées, auteur) et tableau dépliable « Glissement par
  étape ». Dans `GanttView` (prop `baseline`) : barre fantôme hachurée sous
  chaque barre (tâches et étapes), badge « +3 j » / « −2 j » dans la grille,
  ligne « Référence : … (+3 j) » dans l'infobulle.
- **Voyage dans le temps** : onglet « Historique » du projet (`ProjectTimeTravelTab`, masqué
  en mode modèle) — date (champ, curseur, raccourcis 7 / 30 / 90 j,
  « Création »), courbe d'avancement cliquable
  (`charts/ProgressCurveChart.tsx` : avancement moyen + tâches terminées,
  ligne « Consulté »), indicateurs, avancement par étape, **Gantt à la date**
  (`projects/TimeTravelPanels.tsx` : `GanttView` en consultation seule,
  bascule « Au JJ/MM » / « Aujourd'hui comparé » — barres fantômes = version
  passée —, échelle Jour / Semaine / Mois), **matrice des risques /
  opportunités à la date** (`RiskBoard`, bascule Risques / Opportunités,
  « modifié depuis » / « supprimé depuis »), tableau des tâches d'alors
  (filtre « modifiées depuis »). Dates au calendrier de Paris. Carte : `/mindmaps/:id/time-travel`
  (`mindmap/MapTimeTravel.tsx`, lien « Voyage dans le temps » du panneau
  Historique) — arborescence d'alors, supprimés et déplacés depuis.
- **Préférences** (`preferences/FeatureSections.tsx`) : « Fraîcheur » (seuil
  en jours, ancre `#fraicheur`) et « Calendrier (abonnement iCal) » (créer /
  régénérer / désactiver ; adresse montrée une fois avec « Copier », mode
  d'emploi Outlook, iPhone — lien `webcal:` —, Google Agenda).
- Application native : mêmes écrans ; `/graph` et `/mindmaps/:id/time-travel`
  ajoutés à `native/src/App.tsx` ; tout ce qui précède est **en ligne**
  (routes relayées au serveur) et se masque ou affiche « Disponible
  uniquement en ligne » hors connexion.

## Journal quotidien (`/journal` — `journal/JournalView`)

Menu « Journal quotidien » (icône livre-cœur), sous « Prise de notes ».
- **Barre de date** (collante) : jour en toutes lettres, « Aujourd'hui » /
  « Hier » / « Il y a N jours », flèches jour précédent / suivant (suivant
  désactivé aujourd'hui ; Alt+← / Alt+→), icône calendrier
  (`journal/JournalCalendar` : mois par mois, pastille sur les jours
  renseignés, jours futurs désactivés, « Aujourd'hui »), bouton
  « Aujourd'hui » (≥ sm). Changer de jour enregistre d'abord ce qui est en
  attente.
- **Blocs** (ordre canonique, seulement ceux activés) : icône colorée,
  titre, aide, état « Enregistré » / enregistrement / « Non enregistré » ;
  éditeur riche compact (`RichTextEditor`, collage d'image optimiste,
  `EmojiButton`), enregistrement automatique (800 ms, et à la sortie de page).
  **Activité** : actions du jour regroupées par tâche / carte (lien), heure et
  message de la piste d'audit.
- **Rapport** (icône courbe de chaque bloc → `journal/JournalReportDialog`,
  modale / tiroir bas) : dates Du / Au (défaut : J-30 → aujourd'hui),
  raccourcis 7 / 30 / 90 j, graphique amCharts `charts/JournalTrendChart`
  (mots par jour, ou actions ; clic = ouvrir le jour), puis toutes les saisies
  de la période (ou l'activité par jour), la plus récente d'abord.
- Aucun bloc activé : lien vers Préférences → Personnalisation du journal.
- Application native : même écran (`/journal` dans `App.tsx`), **en ligne**.

## Ordre des listes et icônes (`ProjectList`, `MindMapList`, `components/icons/*`, `SortMenu`)

- **Trier** (`SortMenu`) : « Par ordre alphabétique » ou « Par date de mise à
  jour » (la plus récente d'abord) ; devient l'ordre personnel, appliqué aux
  épingles du menu. **Glisser-déposer au pointeur** (souris et doigt,
  `components/usePointerReorder.tsx`) par la **poignée** (points à gauche de
  chaque carte) : repère avant / après la carte visée (moitié gauche / droite
  en grille, haut / bas en colonne), étiquette qui suit le pointeur, Échap
  annule. Projet : déposé sur un projet d'un autre type, il change de type ;
  déposé dans le cadre d'un type (ou en haut), il va en fin de ce groupe.
  Types : poignée de l'en-tête. Le glisser-déposer HTML5 n'est plus utilisé
  (inopérant au doigt, peu fiable sur les cartes).
- **Icônes** : la pastille de chaque projet / carte (listes, en-tête du projet,
  en-tête de l'éditeur de carte) ouvre la **bibliothèque** (`IconPicker`,
  chargé à la demande) : onglet « Bibliothèque » (≈ 1 900 icônes, recherche
  en anglais ou en français — fusée, client, argent…), onglet « Mes icônes »
  (importer une image PNG / JPEG / GIF / WebP, réutiliser, retirer de la
  bibliothèque), « Retirer l'icône ». Affichage : `EntityIcon` (repli sur
  l'icône par défaut pendant le chargement).
