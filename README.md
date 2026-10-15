# Second Brain

Application web (responsive) de « second cerveau » pour un utilisateur connecté,
en production sur https://secondbrain.danielbar-tcg.fr.

1. **Cartes mentales** — mise en page automatique, branches illimitées,
   repli/dépli, couleurs, glisser-déposer pour rattacher une branche ou
   **placer librement les nœuds** (positions mémorisées, « Affichage
   optimisé » pour revenir à la mise en page automatique), et
   **notes en texte riche** sur chaque nœud (titres, listes, cases à cocher,
   liens, images collées directement — aperçu immédiat, envoi en arrière-plan).
   Chaque nœud a un **statut** : ouvert, à surveiller (mis en évidence) ou
   fermé (hachuré, masqué par défaut avec ses sous-nœuds).
2. **Gestion de projet** — projets › **étapes › activités › tâches** (le niveau
   activité est facultatif). L'avancement se saisit sur les tâches et remonte
   automatiquement. Chaque projet a son **équipe** (comptes de l'application ou
   noms libres) avec affectation nominative des tâches, ses **livrables**
   (statut, responsable, dates attendues), ses **documents** (téléversés,
   rattachables à un livrable) et un **tableau de bord** (planning Gantt,
   avancement par étape, statut des livrables). Chaque tâche a une
   **priorité** (basse → critique), une **complexité**, des **sessions de
   travail planifiées** et sa **fiche** avec un fil de commentaires
   hiérarchique (réponses aux réponses) et des mentions « @ ».
   Chaque tâche a un responsable, un **superviseur** et des **contributeurs**.
   **Mes tâches** : synthèse réordonnable, matrice priorité × complexité, vue
   calendaire (glisser-déposer des tâches sur les jours, alerte si après
   l'échéance) et **Kanban** filtrable (semaine, assignation, supervision,
   contribution). Chaque projet a aussi son onglet **Kanban**.
   Une tâche peut n'avoir **ni projet, ni étape, ni activité** (projet virtuel
   « Sans projet »), et se rattacher à des **nœuds de carte mentale** (qui
   affichent leurs tâches ouvertes ; création ou rattachement depuis le nœud).
   **Prise de notes** : arborescence façon Notion de tous les objets (cartes
   › nœuds, projets › étapes › activités › tâches), chargée au fur et à
   mesure, avec un grand document de notes riches par objet, visible ensuite
   sur l'objet.
   **Préférences** : prénom et nom affichés, photo de profil (sinon
   silhouette), changement de mot de passe, 5 thèmes (clair, sombre, sépia, océan, forêt).
   **Administration** (administrateurs, et le super administrateur codé en
   dur) : rôles et managers des utilisateurs, tous les projets, toutes les
   tâches. Un manager voit les tâches de ses N-1 dans « Mon équipe ».
   **Application desktop Windows** (`native/`, Electron) : mêmes écrans,
   projets et cartes **utilisables hors ligne**, synchronisation automatique
   (conflits par champ, le serveur l'emporte, historique « Conflits ») ;
   téléchargement sur `/app`.
   **Messagerie interne** (fils à plusieurs, vu / non vu, réponse à un
   message précis, suppression, emoji) ; **notifications par e-mail**
   (SMTP et activation par type dans l'administration, préférence
   personnelle) ; mot de passe oublié et validation d'adresse ;
   **connecteur MCP** pour interroger ses projets, cartes et notes depuis
   Claude Desktop (clés d'accès dans les Préférences).
   **Recherche globale** avec auto-complétion sur la page d'accueil (projets,
   tâches, nœuds, cartes).
   **Notifications in-app** (cloche) : tâche assignée, réponse à un
   commentaire, tâche assignée mise à jour, mention — cliquables, lues /
   non lues.
3. **Tableau de bord personnel** — mes tâches, échéances à venir, retards,
   répartitions par statut, avancement des projets.

Toute la logique passe par une **API REST versionnée `/api/v1`** (cookie de
session pour le web, jeton `Bearer` pour une future application mobile) —
voir [docs/04-api.md](docs/04-api.md). Tous les graphiques sont en
**amCharts 4**.

## Pile technique

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Prisma 6 +
PostgreSQL 16 · React Flow (`@xyflow/react`) + d3-hierarchy · TipTap ·
amCharts 4 · Docker + Caddy en production.

## Démarrage en développement

```bash
npm install
cp .env.example .env          # ajuster DATABASE_URL
npx prisma migrate dev        # crée la base et applique les migrations
npm run dev                   # http://localhost:3000
```

Une base PostgreSQL locale est nécessaire. Sans serveur installé :
`docker compose up -d db` en publie une sur `localhost:5433` (identifiants dans
`.env.example`).

Créer un compte depuis `/register`, ou en ligne de commande :

```bash
npm run user:create -- --email=moi@exemple.fr --password=motdepasse --name=Daniel
```

## Scripts

| Script | Rôle |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` / `db:deploy` / `db:studio` | Prisma |
| `npm run user:create -- --email=… --password=… [--name=…]` | créer / réinitialiser un utilisateur |
| `npm run test:features` | tests de bout en bout des e-mails (faux serveur SMTP local), de la messagerie, des comptes (mot de passe oublié, validation, changement d'adresse) et du connecteur MCP (serveur de dev lancé) |
| `npm run test:native` | tests de bout en bout du client hors ligne de l'application (serveur de dev lancé) |
| `npm run native:dev` / `native:build` | interface de l'application native dans le navigateur (Vite, relais vers le serveur de dev) / build |
| `npm run desktop:dev` | application desktop Electron en développement (Vite + Electron ; serveur Next lancé à part) |
| `npm run desktop:smoke` | test de démarrage de l'application desktop (profil jetable ; connexion réelle avec `SB_SMOKE_SERVER`, `SB_SMOKE_EMAIL`, `SB_SMOKE_PASSWORD`) |
| `npm run desktop:build` / `desktop:publish` | installateur Windows (`native/release/`) / publication sur le serveur (page `/app`) |
| `npm run ios:sync` / `ios:open` | application iPhone : build de l'interface + mise à jour du projet Xcode `native/ios` / ouverture dans Xcode (Mac) ; envoi TestFlight par le workflow GitHub « iOS TestFlight » |
| `npm run test:sync` | tests de bout en bout de la synchro hors ligne (serveur de dev lancé, `BASE_URL` facultatif) |
| `npm run prod:setup` | provisionner / mettre à jour l'infrastructure serveur (idempotent) |
| `npm run prod:deploy` | mettre en production (push préalable obligatoire) |
| `npm run prod:status` / `prod:logs` / `prod:exec` / `prod:env` / `prod:backup` / `prod:restore` | exploitation |

## Variables d'environnement

| Variable | Rôle |
| --- | --- |
| `DATABASE_URL` | connexion PostgreSQL |
| `SESSION_SECRET` | secret serveur (généré en production) |
| `NEXT_PUBLIC_SITE_URL` | URL publique |
| `ALLOW_REGISTRATION` | `false` pour fermer les inscriptions (`user:create` reste possible) ; `false` par défaut sur une nouvelle installation |
| `SUPER_ADMIN_EMAIL` | facultatif : e-mail du super administrateur (défaut codé dans `src/lib/roles.ts`) |
| `DATA_DIR` | répertoire des fichiers (`./data` par défaut, `/app/data` en Docker) : `uploads/` images des notes, `documents/` documents de projet |
| `APP_PORT` | port publié par docker compose sur `127.0.0.1` uniquement (3001 en production) |
| `DB_PORT` | publication locale de PostgreSQL (`127.0.0.1:5433` en dev, `127.0.0.1:55432` en prod) |

## Documentation

À lire au début de chaque session de travail, à mettre à jour à chaque évolution
(voir [CLAUDE.md](CLAUDE.md)) :

- [docs/01-architecture.md](docs/01-architecture.md) — architecture, authentification, droits, fichiers, graphiques
- [docs/02-data-model.md](docs/02-data-model.md) — modèle de données, invariants, migrations
- [docs/03-screens.md](docs/03-screens.md) — écrans et composants
- [docs/04-api.md](docs/04-api.md) — API REST `/api/v1` (contrat pour l'application mobile)
- [docs/10-deployment.md](docs/10-deployment.md) — déploiement et exploitation
