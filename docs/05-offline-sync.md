# Hors ligne, synchronisation et applications natives

> Statut (15/10/2026) : **phase 1** (socle serveur), **phase 2** (client hors
> ligne) et **phase 3** (application desktop Windows) **implémentées et
> testées** ; **phase 4** (iPhone) à faire — nécessite un Mac ou une CI macOS.
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
  ligne) et `/api/v1/documents/…` avec le jeton ; requêtes serveur par IPC
  (`sb:fetch`, `sb:upload`) ; liens externes dans le navigateur ; instance
  unique ; menu français ; mode `--smoke-test` (profil jetable).
- `preload.cjs` : `window.secondBrain` (contexte isolé, bac à sable).
- Empaquetage `electron-builder` (`native/electron-builder.yml`) : NSIS
  Windows x64, sans aucune dépendance npm embarquée (≈ 110 Mo, essentiellement
  le moteur Electron). Non signé : avertissement SmartScreen à la première
  installation.
- Distribution : `npm run desktop:publish` dépose l'installateur et
  `latest.json` dans `data/downloads` du serveur ; page publique **`/app`**,
  fichier servi par `/downloads/<fichier>`. Le bouton « Mise à jour
  nécessaire » de l'application y mène.

## 6. Phasage et vérifications

| Phase | Contenu | Vérification |
| --- | --- | --- |
| 1. Socle serveur ✅ | `SyncLog`, `AppliedOp`, `pull` / `push`, conflits par champ, protocole | `npm run test:sync` (39 vérifications) |
| 2. Client hors ligne ✅ | magasin, API locale, moteur, conflits, interface Vite | `npm run test:native` (38 vérifications : hors ligne réel, conflits, images, parité locale = serveur, persistance) + parcours dans le navigateur (`npm run native:dev`) |
| 3. Desktop ✅ | coque Electron, installateur, publication | `npm run desktop:smoke` (connexion réelle facultative : `SB_SMOKE_SERVER/EMAIL/PASSWORD`), test de l'exécutable empaqueté |
| 4. iPhone | coque Capacitor (même `native/`), `CapacitorHttp` pour les requêtes, médias absolus, ergonomie tactile, TestFlight | à faire sur Mac / CI macOS (compte Apple Developer) |

Pour l'App Store plus tard : suppression du compte depuis l'application et
politique de confidentialité obligatoires.

## 7. Décisions complémentaires (14/10/2026)

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

## 8. Limites connues

- Hors ligne, les photos des autres membres et les noms d'auteurs de
  commentaires qui ne sont pas membres d'un projet commun ne sont pas connus
  (silhouette, « Utilisateur »).
- Les nouveaux objets créés hors ligne par l'application n'envoient leurs
  notifications qu'à la synchro (le serveur les émet en rejouant l'opération).
- L'ordre des éléments (renumérotation) calculé localement peut être corrigé
  par le serveur à la synchro suivante.
