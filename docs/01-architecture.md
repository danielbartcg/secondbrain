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
  React) — réutilisable dans l'application mobile. Rendu React Flow ;
  positions imposées ; le glisser sert à **rattacher** une branche.
- Mutations optimistes avec identifiants temporaires résolus à la réponse ;
  requêtes sérialisées (file d'attente) ; verrou de ligne `MindMap` côté
  serveur.

## Gestion de projet

- Hiérarchie : `Project › Stage › Activity? › Task`, plus **équipe**
  (`ProjectMember`), **livrables** (`Deliverable`, rattachables à une étape,
  avec responsable, dates attendues, statut), **documents** (`Document`,
  pouvant matérialiser un livrable) et **commentaires de tâche**
  (`TaskComment`, mentions `@[Nom](memberId)`).
- L'avancement n'existe **que sur les tâches** (`progress`, `status`,
  `reconcile()`). Les niveaux supérieurs sont agrégés à la volée
  (`aggregate()`). Rien n'est dénormalisé.
- Toute mutation renvoie le projet complet recalculé ; aucune logique
  d'agrégation côté client.
- Toutes les mutations passent par `mutateProject()` : transaction +
  `SELECT … FOR UPDATE` sur la ligne `Project` (anti-interblocage) +
  rechargement du projet dans la même transaction.
- Affectations et rattachements sont vérifiés comme appartenant au même
  projet (`checkMember`, `checkStage`).

## Tableau de bord personnel (`src/lib/dashboard.ts`)

Agrège, pour les projets actifs / en pause accessibles : mes tâches
(membre rattaché à mon compte), échéances (tâches non terminées et livrables
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
