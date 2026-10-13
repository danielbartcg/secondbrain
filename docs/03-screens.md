# Écrans et composants

Toutes les pages sont sous `src/app/(app)/` (coque authentifiée `AppShell`)
sauf connexion/inscription (`src/app/(auth)/`). UI en français, responsive.

| Route | Page serveur | Composant client principal | Rôle |
| --- | --- | --- | --- |
| `/login`, `/register` | — | formulaires | authentification (API `/auth/*`) |
| `/dashboard` | `dashboard/page.tsx` → `getDashboard` + `listMindMaps` | `dashboard/HomeDashboard` + `GlobalSearch` | tableau de bord personnel, **recherche globale** |
| `/mindmaps` | `mindmaps/page.tsx` | `mindmap/MindMapList` | liste des cartes |
| `/mindmaps/[id]` | `mindmaps/[id]/page.tsx` | `mindmap/MindMapEditor` | éditeur de carte (plein cadre) |
| `/projects` | `projects/page.tsx` | `projects/ProjectList` | liste, filtre par statut, création |
| `/projects/[id]` | `projects/[id]/page.tsx` | `projects/ProjectWorkspace` | espace projet à onglets |
| `/tasks/[taskId]` | `tasks/[taskId]/page.tsx` → `getTaskDetail` | `projects/TaskSheet` | **fiche tâche** (avec ou sans projet) + sessions + fil de commentaires ; l'ancienne adresse `/projects/[id]/tasks/[taskId]` redirige |
| `/projects/sans-projet` | `projects/sans-projet/page.tsx` → `listOrphanTasks` | `projects/OrphanTasks` | projet virtuel **« Sans projet »** : tâches orphelines (création, statut, fiche, suppression) |
| `/organize` | `organize/page.tsx` → `getMyTasks` | `organizer/TaskOrganizer` | **Organiser mes tâches** : Calendrier / Sélection / Synthèse (menu sous « Projets ») |
| `/notifications` | `notifications/page.tsx` | `NotificationsPage` | toutes mes notifications (filtre non lues) |

## Coque (`AppShell`)

Menu : Tableau de bord, Cartes mentales, Projets, **Organiser mes tâches**
(sous-entrée de Projets). **Cloche de notifications** (`NotificationsBell`)
à côté du logo (barre latérale) et dans l'en-tête mobile : pastille rouge =
nombre de non lues ; panneau déroulant façon réseau social (icône par type,
titre, extrait, « il y a … », point bleu si non lue) ; un clic marque lue et
ouvre l'endroit concerné (fiche tâche, commentaire ciblé) ; au survol :
bascule lue / non lue, suppression ; « Tout lu » ; lien « Voir toutes ».

## Organiser mes tâches (`organizer/TaskOrganizer`)

Sélecteur de vue (mémorisé dans le hash : `#calendar`, `#matrix`,
`#synthesis`), compteurs, indicateur d'enregistrement. Items tâche colorés
selon la priorité (rouge critique, ambre haute, indigo moyenne, gris basse).

| Vue | Composant | Contenu |
| --- | --- | --- |
| Calendrier | `CalendarView` | liste « Tâches à planifier » (glissable ; une tâche planifiée est grisée mais reste déposable) + grille mensuelle lun→dim, navigation, aujourd'hui. Déposer sur un jour = **session de travail** ; les sessions se glissent d'un jour à l'autre, se retirent (×), sont liées à la fiche. Session après l'échéance : bordure rouge + ⚠. Drapeau rouge sur les jours d'échéance. Mobile : liste horizontale, sélection au clic puis clic sur un jour |
| Sélection | `MatrixView` | matrice **priorité** (lignes, Critique en haut → Basse) × **complexité** (colonnes Basse / Moyenne / Forte) ; glisser une carte vers une autre zone change sa complexité (et sa priorité si la ligne change) |
| Synthèse | `SynthesisView` | tableau : #, tâche, projet, étape, priorité (modifiable), échéance (rouge si dépassée), statut, « Prévu ? » (oui · n jours / non) ; glisser les lignes = ordre relatif personnel |

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
| Tableau de bord | `ProjectDashboardTab` | KPIs ; **planning Gantt** (`PlanningChart`) des étapes (part réalisée en plein) et livrables 📦 avec ligne « aujourd'hui » ; avancement par étape (`ProgressBarsChart`) ; tâches par statut ; statut des livrables (anneau + liste) ; tâches en retard |
| Plan | `ProjectBoard` | bloc **« Tâches sans étape »** (tâches du projet non rattachées à une étape, ajout rapide) puis étapes › activités › tâches : drapeau de priorité, avancement (curseur, envoi différé 400 ms), statut cliquable, responsable (avatar), échéance, commentaires, réordonnancement, lien fiche tâche ; détails rapides : priorité, complexité, dates, clôture |
| Livrables | `DeliverablesTab` | cartes : statut, responsable, étape, début/fin attendus, documents rattachés (téléversement direct, rattachement d'un document existant, détachement, téléchargement) |
| Documents | `DocumentsTab` | **explorateur à dossiers** : fil d'Ariane, sous-dossiers du dossier courant (créer, renommer, « Déplacer vers… », supprimer → contenu remonté dans le parent), documents du dossier courant (sélecteur de dossier, « matérialise le livrable … », téléchargement, suppression par l'auteur ou le propriétaire) ; dépôt (bouton ou glisser-déposer) **dans le dossier courant** |
| Équipe | `TeamTab` | membres (avatar, rôle, couleur, nb de tâches) ; ajout en **nom libre** ou **compte de l'application** (recherche par e-mail exact) ; retrait (propriétaire uniquement, jamais le propriétaire lui-même) |

État partagé : `run(fn)` exécute une mutation API, remplace le projet par la
réponse recalculée, recharge en cas d'erreur.

## Fiche tâche (`TaskSheet`)

- Fil d'Ariane : projet (ou « Sans projet ») › étape › activité.
- Carte principale : badges (statut, priorité, retard, nb commentaires),
  titre éditable, boutons de statut À faire / En cours / Terminée + curseur
  d'avancement, champs **Priorité / Complexité / Responsable** (désactivé sans
  projet) **/ Début / Échéance**, description, suppression.
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

**Tâches d'un nœud** (`NodeTasksPanel`, dans le panneau) : liste des tâches
rattachées (statut cliquable, projet ou « Sans projet », fiche, détachement),
« Nouvelle » (crée une tâche sans projet rattachée au nœud), « Existante »
(recherche puis rattachement). Indicateur visuel sur le nœud : pastille
bleue avec le nombre de tâches **non clôturées** (terminées comprises).
Arrivée par `?node=<id>` (recherche, fiche tâche) : nœud sélectionné, centré,
panneau ouvert, nœuds fermés affichés si nécessaire.

## Composants partagés (`src/components/ui.tsx`)

`PageHeader`, `Button`, `ProgressBar`, `InlineEdit` (clic pour éditer),
`QuickAdd`, `EmptyState`, `Avatar` (initiales, couleur stable par id),
`Badge`, `PriorityFlag`, constantes de libellés/couleurs (`TASK_STATUS_*`,
`DELIVERABLE_STATUS_*`, `PRIORITY_*` dont `PRIORITY_CHIP`, `COMPLEXITY_*`,
`NODE_STATUS_LABEL`), helpers `formatDate`, `formatBytes`, `relativeDays`,
`ymd` / `todayYmd` (jour local `AAAA-MM-JJ`).

## Graphiques (`src/components/charts/`)

`AmChart` (enveloppe amCharts 4), `StatusDonut`, `ProgressBarsChart`,
`PlanningChart`. Règle : tout nouveau graphique = nouveau composant dans ce
dossier, construit avec amCharts 4.
