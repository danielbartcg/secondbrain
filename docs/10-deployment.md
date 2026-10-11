# Déploiement et exploitation

Second Brain tourne sur le **même VPS que la boutique TCG** : Caddy route
chaque domaine vers le port local de son application. Rien n'est partagé entre
les deux applications (dépôt, base, conteneurs, sauvegardes distincts).

| | Boutique | Second Brain |
| --- | --- | --- |
| Dépôt serveur | `/home/deploy/boutique` | `/home/deploy/secondbrain` |
| Port local | 3000 | **3001** |
| Site Caddy | `/etc/caddy/sites/boutique.caddy` | `/etc/caddy/sites/secondbrain.caddy` |
| Base | conteneur `boutique-db-1` | conteneur `secondbrain-db-1` |
| Sauvegardes | `/home/deploy/backups` | `/home/deploy/backups-secondbrain` (cron 3h25) |

## Configuration locale

Les scripts `ops/` lisent `.env.deploy` (gitignoré) : hôte, utilisateur, clé
SSH, domaine, dépôt, port. Modèle : `.env.deploy.example`.

## Première installation

```bash
npm run prod:setup
```

Idempotent. Sur un serveur déjà provisionné pour la boutique, il se contente
d'ajouter : le site Caddy du domaine, le clone du dépôt, le `.env` (secrets
générés), le répertoire `data/uploads`, le cron de sauvegarde.

Prérequis : le DNS `secondbrain.danielbar-tcg.fr` → IP du serveur (enregistrement
A). Caddy obtient le certificat Let's Encrypt automatiquement dès que le
domaine résout ; avant cela, le site répond en erreur TLS.

## Mettre en production

```bash
git push origin main
npm run prod:deploy
```

Séquence : sauvegarde (si la base tourne) → `git pull` → build des images →
`prisma migrate deploy` (conteneur `tools`) → recréation du conteneur `app` →
contrôle de santé HTTPS.

Options : `--skip-backup`, `--force` (déployer malgré des commits non poussés —
inutile, le serveur tire GitHub).

## Exploitation

| Commande | Rôle |
| --- | --- |
| `npm run prod:status` | conteneurs, ressources, sauvegardes, version, ping HTTPS |
| `npm run prod:logs -- [--tail=500] [--follow] [--service=db]` | journaux |
| `npm run prod:exec -- "npx tsx scripts/create-user.ts --email=… --password=… --name=…"` | commande dans le conteneur `tools` |
| `npm run prod:exec -- --service=db "psql -U secondbrain secondbrain -c '\dt'"` | SQL direct |
| `npm run prod:env` / `-- --set CLE=valeur --restart` | lire / modifier le `.env` serveur (jamais à la main) |
| `npm run prod:backup [-- --pull]` | sauvegarde immédiate (dump + uploads), rapatriement optionnel |
| `npm run prod:restore -- --file=db-….dump --yes` | restauration (destructive, sauvegarde préalable automatique) |

Fermer les inscriptions une fois votre compte créé :

```bash
npm run prod:env -- --set ALLOW_REGISTRATION=false --restart
```

## Conteneurs (docker-compose.yml)

- `db` : PostgreSQL 16, volume `postgres_data`, publié sur `127.0.0.1:55432`
  en production (`DB_PORT`) — jamais exposé publiquement.
- `app` : image standalone Next.js, port `APP_PORT:3000`, volume
  `./data/uploads`.
- `tools` (profil `tools`) : étage `builder` de la même image, pour les
  migrations et les scripts. Même uid 1001 que l'application.

## Pièges connus

- Les commandes distantes sont encodées en base64 (`ops/lib/ssh.ts`) : pas
  d'échappement à gérer, et `docker compose run` ne peut pas avaler le reste du
  script.
- `data/uploads` doit exister **avant** le premier `docker compose up`, sinon
  Docker le crée en root et l'application (uid 1001) ne peut plus écrire.
  `provision.sh` et `deploy.ts` s'en chargent.
- Le cache de build Docker est plafonné (`/etc/docker/daemon.json`, posé par
  le provisionnement de la boutique).
