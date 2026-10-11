# Second Brain

Application web (responsive) de « second cerveau » pour un utilisateur connecté :

1. **Cartes mentales** — carte à mise en page automatique, nœuds illimités,
   repli/dépli des branches, couleurs, glisser-déposer pour rattacher une
   branche ailleurs, et **notes en texte riche** sur chaque nœud (titres,
   listes, cases à cocher, liens, images collées directement — aperçu immédiat,
   envoi en arrière-plan).
2. **Gestion de projet** — projets › **étapes › activités › tâches**. Le niveau
   « activité » est facultatif : une tâche peut être rattachée directement à
   une étape. L'avancement (0–100 %, statut à faire / en cours / terminée) se
   saisit sur les tâches et remonte automatiquement aux activités, étapes et
   projets.

Toute la logique passe par une **API REST versionnée `/api/v1`** (cookie de
session pour le web, jeton `Bearer` pour une future application mobile) —
voir [docs/04-api.md](docs/04-api.md).

## Pile technique

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Prisma 6 +
PostgreSQL 16 · React Flow (`@xyflow/react`) + d3-hierarchy · TipTap ·
Docker + Caddy en production.

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
| `npm run prod:setup` | provisionner le serveur (idempotent) |
| `npm run prod:deploy` | mettre en production (push préalable obligatoire) |
| `npm run prod:status` / `prod:logs` / `prod:exec` / `prod:env` / `prod:backup` | exploitation |

## Variables d'environnement

| Variable | Rôle |
| --- | --- |
| `DATABASE_URL` | connexion PostgreSQL |
| `SESSION_SECRET` | secret serveur (généré en production) |
| `NEXT_PUBLIC_SITE_URL` | URL publique |
| `ALLOW_REGISTRATION` | `false` pour fermer les inscriptions (`user:create` reste possible) |
| `DATA_DIR` | répertoire des uploads (`./data` par défaut, `/app/data` en Docker) |
| `APP_PORT` | port local publié par docker compose (3001 en production) |

## Documentation

- [docs/01-architecture.md](docs/01-architecture.md) — architecture, authentification, conventions
- [docs/02-data-model.md](docs/02-data-model.md) — modèle de données
- [docs/04-api.md](docs/04-api.md) — API REST `/api/v1` (contrat pour l'application mobile)
- [docs/10-deployment.md](docs/10-deployment.md) — déploiement et exploitation
