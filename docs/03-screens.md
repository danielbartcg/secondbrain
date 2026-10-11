# Écrans et composants

Toutes les pages sont sous `src/app/(app)/` (coque authentifiée `AppShell`)
sauf connexion/inscription (`src/app/(auth)/`). UI en français, responsive.

| Route | Page serveur | Composant client principal | Rôle |
| --- | --- | --- | --- |
| `/login`, `/register` | — | formulaires | authentification (API `/auth/*`) |
| `/dashboard` | `dashboard/page.tsx` → `getDashboard` + `listMindMaps` | `dashboard/HomeDashboard` | tableau de bord personnel |
| `/mindmaps` | `mindmaps/page.tsx` | `mindmap/MindMapList` | liste des cartes |
| `/mindmaps/[id]` | `mindmaps/[id]/page.tsx` | `mindmap/MindMapEditor` | éditeur de carte (plein cadre) |
| `/projects` | `projects/page.tsx` | `projects/ProjectList` | liste, filtre par statut, création |
| `/projects/[id]` | `projects/[id]/page.tsx` | `projects/ProjectWorkspace` | espace projet à onglets |
| `/projects/[id]/tasks/[taskId]` | `.../tasks/[taskId]/page.tsx` → `getTaskDetail` | `projects/TaskSheet` | fiche tâche + commentaires |

## Tableau de bord personnel (`HomeDashboard`)

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
| Plan | `ProjectBoard` | étapes › activités › tâches : avancement (curseur, envoi différé 400 ms), statut cliquable, responsable (avatar), échéance, commentaires, réordonnancement, lien fiche tâche |
| Livrables | `DeliverablesTab` | cartes : statut, responsable, étape, début/fin attendus, documents rattachés (téléversement direct, rattachement d'un document existant, détachement, téléchargement) |
| Documents | `DocumentsTab` | zone de dépôt (glisser-déposer), liste, renommage, « matérialise le livrable … », téléchargement, suppression (auteur ou propriétaire) |
| Équipe | `TeamTab` | membres (avatar, rôle, couleur, nb de tâches) ; ajout en **nom libre** ou **compte de l'application** (recherche par e-mail exact) ; retrait (propriétaire uniquement, jamais le propriétaire lui-même) |

État partagé : `run(fn)` exécute une mutation API, remplace le projet par la
réponse recalculée, recharge en cas d'erreur.

## Fiche tâche (`TaskSheet`)

- Carte principale : badges (statut, retard, nb commentaires), titre éditable,
  boutons de statut + curseur d'avancement, champs **Responsable / Début /
  Échéance / Rattachement** (étape ou étape › activité), description,
  suppression.
- **Échanges** : fil de commentaires (avatar, auteur, date), suppression par
  l'auteur ou le propriétaire. Zone de saisie avec **mentions** : taper `@`
  puis des lettres filtre les membres (↑/↓, Entrée/Tab pour insérer, Échap) ;
  l'insertion produit `@[Nom](memberId)`, rendu en surbrillance. Ctrl+Entrée
  envoie.

## Éditeur de carte (`MindMapEditor`)

Voir docs/01-architecture.md § Cartes mentales. Raccourcis : Tab enfant,
Entrée frère, Suppr, F2 renommer, Espace replier, Échap. Panneau latéral
(tiroir bas sur mobile) : titre, couleur, notes riches (`RichTextEditor`).

## Composants partagés (`src/components/ui.tsx`)

`PageHeader`, `Button`, `ProgressBar`, `InlineEdit` (clic pour éditer),
`QuickAdd`, `EmptyState`, `Avatar` (initiales, couleur stable par id),
`Badge`, constantes de libellés/couleurs de statut (`TASK_STATUS_*`,
`DELIVERABLE_STATUS_*`), helpers `formatDate`, `formatBytes`, `relativeDays`.

## Graphiques (`src/components/charts/`)

`AmChart` (enveloppe amCharts 4), `StatusDonut`, `ProgressBarsChart`,
`PlanningChart`. Règle : tout nouveau graphique = nouveau composant dans ce
dossier, construit avec amCharts 4.
