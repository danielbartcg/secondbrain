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

Domaine : `secondbrain.danielbar-tcg.fr` (enregistrement A dans la zone DNS
OVH de `danielbar-tcg.fr`). Certificat Let's Encrypt automatique par Caddy.

## Configuration locale

Les scripts `ops/` lisent `.env.deploy` (gitignoré) : hôte, utilisateur, clé
SSH, domaine, dépôt, port. Modèle : `.env.deploy.example`.

## Première installation / mise à jour de l'infrastructure

```bash
npm run prod:setup
```

Idempotent. Sur un serveur déjà provisionné, il se contente d'ajouter ou de
réécrire : le site Caddy du domaine (limite de corps 30 Mo), le clone du dépôt,
le `.env` (secrets générés, laissé intact s'il existe), les répertoires
`data/uploads` et `data/documents` (uid 1001), le cron de sauvegarde.
**À relancer chaque fois que `ops/server/provision.sh` change.**

`apt-get update` est non bloquant : le dépôt apt de Caddy (cloudsmith)
répond parfois 402 ; Caddy étant déjà installé, on continue.

## Mettre en production

```bash
git push origin main
npm run prod:deploy
```

Séquence : sauvegarde (si la base tourne) → `git pull` → build des images →
`prisma migrate deploy` (conteneur `tools`) → `chown` des données →
recréation du conteneur `app` → contrôle de santé HTTPS (2 min).

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
| `npm run prod:backup [-- --pull]` | sauvegarde immédiate (dump + uploads + documents), rapatriement optionnel |
| `npm run prod:restore -- --file=db-….dump --yes` | restauration (destructive, sauvegarde préalable automatique) |
| `npm run desktop:build` puis `npm run desktop:publish` | construit l'installateur Windows (`native/release/`) puis le dépose dans `data/downloads` du serveur (page `/app`) |

Les nouvelles installations (`provision.sh`) démarrent inscriptions
**fermées** (`ALLOW_REGISTRATION="false"`) : créer les comptes avec
`scripts/create-user.ts` (via `prod:exec`). Fermer les inscriptions d'une
installation existante :

```bash
npm run prod:env -- --set ALLOW_REGISTRATION=false --restart
```

## Conteneurs (docker-compose.yml)

- `db` : PostgreSQL 16, volume `postgres_data`, publié sur `127.0.0.1:55432`
  en production (`DB_PORT`) — jamais exposé publiquement.
- `app` : image standalone Next.js, port `127.0.0.1:APP_PORT:3000` (boucle
  locale uniquement : seul Caddy l'atteint, et le rate limiting se fie au
  `X-Forwarded-For` qu'il pose), volumes
  `./data/uploads`, `./data/documents` et `./data/downloads` (installateurs
  de l'application desktop, non sauvegardés : republiables).
- `tools` (profil `tools`) : étage `builder` de la même image, pour les
  migrations et les scripts. Même uid 1001 que l'application.

## Application iPhone (TestFlight)

Pas de build iOS possible sous Windows : le workflow GitHub Actions
`.github/workflows/ios-testflight.yml` (déclenchement manuel, runner macOS)
construit l'interface, synchronise `native/ios`, archive et envoie le build à
App Store Connect (numéro de build = numéro d'exécution du workflow).

Préalables, une fois :
1. compte Apple Developer (99 €/an) ; créer l'app `fr.danielbartcg.secondbrain`
   dans App Store Connect ;
2. clé d'API App Store Connect (rôle Admin, pour la signature automatique) ;
3. secrets du dépôt : `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`,
   `ASC_KEY_P8_BASE64` (`base64 -w0 AuthKey_XXXX.p8`) ;
4. dans TestFlight, ajouter les testeurs (internes : immédiat ; externes :
   revue bêta d'Apple).

Sur un Mac, alternative manuelle : `npm ci`, `npm run ios:sync`,
`npm run ios:open`, puis Product → Archive dans Xcode.

## E-mails (SMTP)

Aucune variable d'environnement : le serveur SMTP se saisit dans
**Administration → Notifications** (hôte, port, TLS direct ou STARTTLS,
utilisateur, mot de passe, expéditeur), puis « Envoyer un e-mail de test » et
l'interrupteur général. Le mot de passe est chiffré avec une clé dérivée de
`SESSION_SECRET` : changer ce secret oblige à ressaisir le mot de passe SMTP.
L'envoi sortant se fait depuis le conteneur `app` (port 587 ou 465 sortant
ouvert chez l'hébergeur). Tant que l'envoi n'est pas activé, « Mot de passe
oublié » n'apparaît pas et aucun e-mail de compte ne part.

## Connecteur MCP (Claude Desktop)

Rien à configurer côté serveur : chaque utilisateur crée sa clé dans
Préférences → Connecteur Claude ; l'adresse est
`https://secondbrain.danielbar-tcg.fr/api/v1/mcp`. Claude Desktop passe par
`npx mcp-remote` (Node.js requis sur le poste).

## Mise à jour de l'application desktop

- Publier : incrémenter `native/electron/package.json`, `npm run desktop:build`,
  `npm run desktop:publish`. Les applications ≥ 0.2.0 lisent
  `GET /downloads/latest.json` (public, `no-cache`) 10 s après le lancement, toutes
  les heures et au retour sur la fenêtre (10 min min.), ou via Préférences → « Rechercher une mise à jour ».
- L'installateur est vérifié (SHA-256 de `latest.json`) avant d'être lancé en
  silencieux (`/S --updated --force-run`) ; `--updated` évite que l'ancienne version soit désinstallée raccourcis compris (l'application se désépinglait de la barre des tâches à chaque mise à jour, corrigé en 0.3.10 ; la mise à jour depuis 0.3.9 ou avant désépingle encore une dernière fois). L'application pose aussi son AppUserModelID (= `appId`). Ne jamais modifier l'installateur ni
  `latest.json` à la main sur le serveur.
- Les 3 derniers installateurs sont conservés ; un retour arrière consiste à
  republier une version **supérieure** (l'updater n'installe jamais une version
  inférieure ou égale).
- Les postes en 0.1.x installent 0.2.0 une fois à la main depuis `/app`.

## Inscriptions

Ouvertes / fermées depuis Administration → Utilisateurs (réglage en base).
`ALLOW_REGISTRATION=false` dans le `.env` du serveur les ferme quoi qu'il arrive.

## Sauvegardes

`ops/server/backup.sh` (cron quotidien 3h25 + `prod:backup`) produit
`db-<date>.dump` (pg_dump format custom) et `files-<date>.tar.gz`
(`data/uploads` + `data/documents`), rotation 14 jours. Copie hors-site
Backblaze possible si un profil rclone `b2` et `~/.config/secondbrain/backup.env`
existent (non configuré pour l'instant).

## Pièges connus

- Les commandes distantes sont encodées en base64 (`ops/lib/ssh.ts`) : pas
  d'échappement à gérer, et `docker compose run` ne peut pas avaler le reste du
  script.
- `data/uploads`, `data/documents` et `data/downloads` doivent exister **avant** le premier
  `docker compose up`, sinon Docker les crée en root et l'application
  (uid 1001) ne peut plus écrire. `provision.sh` et `deploy.ts` s'en chargent.
- Un fichier `.sh` modifié sous Windows doit rester en LF (`.gitattributes`).
- Le cache de build Docker est plafonné (`/etc/docker/daemon.json`, posé par
  le provisionnement de la boutique).
- Le contrôle de santé échoue tant que le DNS ne pointe pas sur le serveur ;
  les conteneurs tournent quand même (`curl http://localhost:3001` sur le VPS).
