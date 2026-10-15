# Hors ligne, synchronisation et applications natives

> Statut (15/10/2026) : **phase 1** (socle serveur), **phase 2** (client hors
> ligne) et **phase 3** (application desktop Windows) **implémentées, testées
> et en production** (installateur sur `/app`) ; **phase 4** (iPhone)
> **préparée** (projet Capacitor, workflow TestFlight) mais **jamais compilée
> ni testée** : il faut un compte Apple Developer et le premier passage du
> workflow macOS (docs/10-deployment.md).
>
> Décisions prises avec Daniel le 14/10/2026 : interface web embarquée dans
> une coque native ; **modification** hors ligne ; conflits **par champ**, le
> serveur gagne et l'utilisateur est notifié ; périmètre hors ligne =
> **projets et cartes mentales** (pas les fichiers des documents) ; diffusion
> **TestFlight** et installateur direct, stores plus tard ; ordre : socle de
> synchro, puis desktop, puis iPhone ; **le site web reste strictement en
> ligne** ; **simplicité** : une application incompatible demande une mise à
> jour, aucune compatibilité ascendante.

## 1. Architecture

```
┌──────── Application native (Electron aujourd'hui ; Capacitor/iPhone demain) ───────┐
│  Composants React du site (src/components) — empaquetés par Vite (native/)          │
│     │  api.get/post… (src/lib/client.ts, transport remplacé)                        │
│     ▼                                                                               │
│  API locale (native/src/local/api.ts) : mêmes routes /api/v1, même forme de DTO     │
│     │ lit / écrit                         │ hors périmètre : relais serveur (en ligne)│
│     ▼                                     ▼                                         │
│  Magasin local (IndexedDB, store.ts)   File d'attente (outbox) ── push ──┐          │
│     ▲                                                                    │          │
│     └──────────── pull : changements depuis le curseur ◄───────────────┐ │          │
└────────────────────────────────────────────────────────────────────────┼─┼──────────┘
                                                                         │ ▼
                         API /api/v1/sync (Next.js) ─► logique métier src/lib ─► PostgreSQL
                                   ▲ journal SyncLog alimenté par déclencheur
```

- **Une seule interface** : les écrans de l'application sont les composants du
  site. `next/link` et `next/navigation` sont remplacés par un petit routeur
  (`native/src/shims`), `api` (client.ts) reçoit un **transport** qui sert les
  routes depuis la base locale (`setApiTransport`, nul sur le site).
- **Mêmes DTO et mêmes règles** : les constructeurs de DTO et les règles pures
  (`toProjectDto`, `toTaskDto`, `reconcile`, `isMyTask`, `resolveMentions`…)
  sont dans `src/lib/shared/` et servent au serveur comme au client. L'API
  locale applique les mêmes règles que le serveur pour un affichage immédiat ;
  le serveur rejoue l'opération et reste l'autorité.
- Choix **Electron plutôt que Tauri** : pas de chaîne Rust sur le poste, et
  IndexedDB est durable dans Chromium (profil applicatif). Le même client
  tournera dans la WebView de Capacitor (IndexedDB d'application iOS).

## 2. Périmètre synchronisé

> Les prérequis de tâches (`Task.prerequisiteIds`) sont une colonne de la
> tâche : synchronisés sans rien de plus ; l'API locale applique les mêmes
> règles (`src/lib/shared/prerequisites.ts`). Épingles du menu et messagerie :
> en ligne uniquement.

| Synchronisé hors ligne (lecture + écriture) | Lecture seule hors ligne | Relayé au serveur (en ligne seulement) |
| --- | --- | --- |
| Cartes, nœuds (titre, notes, statut, couleur, position, repli), liens nœud ↔ tâche ; projets, étapes, activités, tâches (tous champs, contributeurs, sessions de travail), notes des objets, commentaires (ajout / suppression) | Équipe des projets, livrables, liste des documents et dossiers | Gestion d'équipe, livrables, documents (dépôt, téléchargement), profil et mot de passe, notifications (liste vide hors ligne), administration, « Mon équipe » |

Recherche, tableau de bord, « Mes tâches » et arborescence « Prise de notes »
sont calculés localement. L'ordre personnel « Mes tâches » est gardé
localement et envoyé au serveur quand c'est possible.

## 3. Côté serveur (`src/lib/sync.ts`)

- **Journal `SyncLog`** alimenté par le déclencheur PostgreSQL `sb_sync_log`
  sur les 14 tables (création, champ modifié, suppression ; portée projet /
  carte / propriétaire). Toute écriture — web ou application — est journalisée
  sans code applicatif. `seq` = curseur de synchro et **version par champ**.
- **`GET /sync/pull`** : instantané complet (premier lancement), puis
  changements depuis un curseur (pages), avec les versions des champs ;
  instantané ciblé `?project=` / `?map=` pour un élément entrant dans le
  périmètre ; `scope` = projets et cartes visibles (le client purge le reste).
- **`POST /sync/push`** : rejoue les opérations **par les fonctions métier
  existantes** (accès, invariants, notifications), identifiants fournis par le
  client, idempotence par `opId` (`AppliedOp`), état serveur et versions
  renvoyés après chaque opération.
- **Conflits** : un champ n'est appliqué que si personne ne l'a modifié depuis
  la version connue du client ; sinon valeur serveur conservée et renvoyée. Une
  suppression est refusée si l'objet a changé depuis ; une modification d'un
  objet supprimé sur le serveur est refusée (la suppression gagne).
- **Version de protocole** `SYNC_PROTOCOL_VERSION` (en-tête
  `X-Sync-Protocol`) : sinon **426** et l'application demande une mise à jour.

## 4. Côté application (`native/src/local`)

| Module | Rôle |
| --- | --- |
| `db.ts` | IndexedDB : `rows` (« Entité\|id » → données + versions), `outbox`, `conflicts`, `meta` |
| `store.ts` | tables en mémoire, écritures regroupées en base, suppressions en cascade (comme les clés étrangères) |
| `model.ts` | reconstruit les DTO serveur depuis la base locale (constructeurs partagés) : projet, tâche, fiche, cartes, mes tâches, tableau de bord, notes, recherche |
| `api.ts` | routes `/api/v1` locales : écritures avec les règles du serveur + opération en file ; relais serveur hors périmètre (503 `OFFLINE` hors ligne) ; images collées hors ligne gardées en `data:` |
| `sync.ts` | moteur : file **fusionnée** (création + modifications = une création ; création + suppression = rien), versions capturées à la modification, push par lots, conflits → historique, mise à niveau des versions des opérations suivantes, pull, purge du périmètre, téléversement des images `data:` avant envoi, 426 → « mise à jour nécessaire », 401 → reconnexion |
| `remote.ts` | transport serveur : pont Electron (processus principal), relais Vite en développement, `fetch` en test |
| `runtime.ts` | assemblage, connexion (`signIn`) et déconnexion |

Synchronisation : au démarrage, au retour du réseau / du focus, toutes les
30 s et 1,5 s après une écriture. Écrans : bandeau « Des modifications sont
arrivées du serveur — Actualiser » sur les écrans d'édition, actualisation
automatique des listes. Encart d'état au-dessus du menu (en ligne / hors ligne,
modifications en attente, dernière synchro, conflits, bascule « Hors ligne »).
Page **Conflits** : votre valeur et la valeur retenue, « Copier ma valeur ».

## 5. Application desktop (`native/electron`)

- `main.cjs` : protocole `app://local/` (interface depuis `renderer/`, repli
  `index.html`), relais `/media/…` avec **cache disque** (images visibles hors
  ligne) et `/api/v1/documents/<id>/download` avec le jeton (chemin brut,
  non décodé ; tout autre `/api/…` : 404) ; requêtes serveur par IPC
  (`sb:fetch`, `sb:upload`) **limitées à l'origine de la session** (plus
  `POST /api/v1/auth/login` vers le serveur annoncé par `sb:setServer` pendant
  une connexion), méthodes GET/POST/PATCH/PUT/DELETE, en-têtes filtrés : le
  jeton `Authorization: Bearer` est ajouté par le processus principal, jamais
  repris de l'interface ; `session.json` chiffre le jeton avec `safeStorage`
  quand le système le permet ; liens externes dans le navigateur ; instance
  unique ; menu français (outils de développement seulement hors paquet ou
  avec `SB_DEV_URL`) ; mode `--smoke-test` (profil jetable).
- `preload.cjs` : `window.secondBrain` (contexte isolé, bac à sable).
- Connexion : HTTPS obligatoire (sauf `localhost` / `127.0.0.1`). Le HTML
  des notes est assaini (`sanitizeNotes`) au rendu par `native/src/local/model.ts`.
  CSP en balise `<meta>` injectée au build (`native/vite.config.mts`,
  `'self'` = `app://local` / `capacitor://localhost`).
- Empaquetage `electron-builder` (`native/electron-builder.yml`) : NSIS
  Windows x64, sans aucune dépendance npm embarquée (≈ 110 Mo, essentiellement
  le moteur Electron). Non signé : avertissement SmartScreen à la première
  installation.
- Distribution : `npm run desktop:publish` dépose l'installateur et `latest.json`
  (`{platform, version, file, size, sha256, publishedAt}`) dans `data/downloads`
  du serveur ; page publique **`/app`**, fichier servi par `/downloads/<fichier>`
  (nom contrôlé : regex de l'installateur ou exactement `latest.json`, servi en
  `no-cache`). Le bouton « Mise à jour nécessaire » y mène.
- **Mises à jour (coque ≥ 0.2.0)** : `native/electron/updater.cjs` (sans
  dépendance npm). Le processus principal lit `<serveur de la session>/downloads/latest.json`
  (à défaut `https://secondbrain.danielbar-tcg.fr`) 10 s après le démarrage puis
  toutes les 6 h (Windows, pas en `--smoke-test`), compare la version à
  `app.getVersion()` et l'annonce à l'interface (`sb:update-available`). IPC
  `sb:checkUpdate` / `sb:installUpdate` **sans paramètre** (serveur et fichier
  déterminés par le processus principal). Installation : téléchargement dans
  `%TEMP%` avec progression, **vérification SHA-256**, lancement détaché
  silencieux (`/S --force-run`), puis l'application quitte et redémarre mise à
  jour. Avant : `syncNow` + `store.flush` ; s'il reste des opérations, elles
  sont conservées (IndexedDB et `session.json` dans `userData`). Les coques
  0.1.x n'ont pas d'updater : installer 0.2.0 une fois depuis `/app`.
- Liste blanche des routes relayées avec le jeton par le protocole `app://` :
  téléchargement de document et export Excel d'un projet.
- Réunions, risques, historique des tâches, export : en ligne uniquement
  (relayés au serveur par l'API locale).

## 6. Application iPhone (`capacitor.config.ts`, `native/ios`)

- Même interface que le desktop (build Vite `native/electron/renderer`),
  servie par Capacitor depuis `capacitor://localhost` ; données locales dans
  l'IndexedDB de la WebView de l'application (non purgée comme celle de Safari).
- Requêtes serveur : `fetch` ordinaire, détourné vers la pile réseau native
  par **CapacitorHttp** (pas de CORS, aucun changement côté serveur).
- Images des notes : l'API locale renvoie des URL `/media/…` **absolues**
  (serveur) et les remet en relatif à l'enregistrement
  (`native/src/local/platform.ts`) ; elles se chargent en ligne, et hors
  ligne seulement si la WebView les a gardées en cache.
- Zones sûres (encoche) : la WebView reste dans la zone sûre, fond assorti.
- `Info.plist` : nom « Second Brain », région `fr`, pas de chiffrement non
  exempté (évite la question d'export à chaque build). Icône générée par
  `node native/scripts/make-icon.mjs --ios`.
- Build et envoi TestFlight : docs/10-deployment.md.
- Non disponible sur iPhone pour l'instant : téléchargement des documents de
  projet (lien vers une route authentifiée par cookie).

## 7. Phasage et vérifications

| Phase | Contenu | Vérification |
| --- | --- | --- |
| 1. Socle serveur ✅ | `SyncLog`, `AppliedOp`, `pull` / `push`, conflits par champ, protocole | `npm run test:sync` (39 vérifications) |
| 2. Client hors ligne ✅ | magasin, API locale, moteur, conflits, interface Vite | `npm run test:native` (41 vérifications : hors ligne réel, conflits, images, parité locale = serveur, persistance) + parcours dans le navigateur (`npm run native:dev`) |
| 3. Desktop ✅ | coque Electron, installateur, publication | `npm run desktop:smoke` (connexion réelle facultative : `SB_SMOKE_SERVER/EMAIL/PASSWORD`), test de l'exécutable empaqueté |
| 4. iPhone (préparé) | coque Capacitor (même `native/`), `CapacitorHttp`, médias absolus, icône, workflow TestFlight | réécriture des médias couverte par `test:native` ; compilation et essai sur iPhone **à faire** (workflow macOS + compte Apple) |

Pour l'App Store plus tard : suppression du compte depuis l'application et
politique de confidentialité obligatoires.

## 8. Décisions complémentaires (14/10/2026)

1. **Suppression contre modification** : une suppression faite sur le serveur
   l'emporte sur une modification hors ligne ; une suppression faite hors
   ligne est **refusée** si l'objet a été modifié sur le serveur depuis.
2. **Valeurs écrasées** : conservées dans un historique local « Conflits »
   consultable, pour pouvoir les recopier (notes riches notamment).
3. **Version web** : reste **strictement en ligne** (le rendre hors ligne
   serait du travail en plus).
4. **Simplicité** : si l'application n'est plus compatible avec l'API
   (version de protocole), elle demande une mise à jour ; aucune
   compatibilité ascendante.

## 9. Limites connues

- Hors ligne, les photos des autres membres et les noms d'auteurs de
  commentaires qui ne sont pas membres d'un projet commun ne sont pas connus
  (silhouette, « Utilisateur »).
- Les nouveaux objets créés hors ligne par l'application n'envoient leurs
  notifications qu'à la synchro (le serveur les émet en rejouant l'opération).
- L'ordre des éléments (renumérotation) calculé localement peut être corrigé
  par le serveur à la synchro suivante.
