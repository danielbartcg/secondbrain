# Instructions pour Claude Code — Second Brain

## Avant toute chose : lire, puis tenir à jour la documentation

Les markdowns de `docs/` sont la mémoire du projet et se réutilisent d'un
projet à l'autre. **Lire au début de chaque session** :

1. [docs/01-architecture.md](docs/01-architecture.md) — briques, décisions, conventions ;
2. [docs/02-data-model.md](docs/02-data-model.md) — modèle Prisma et invariants ;
3. [docs/03-screens.md](docs/03-screens.md) — écrans et composants ;
4. [docs/04-api.md](docs/04-api.md) — contrat REST `/api/v1` (web + mobile) ;
5. [docs/10-deployment.md](docs/10-deployment.md) — exploitation du VPS.

**Toute évolution DOIT être répercutée** dans ces fichiers **avant** de
considérer la tâche terminée : nouveau modèle → 02, nouvel écran/composant →
03, nouvel endpoint ou champ → 04, nouvelle brique ou décision → 01, nouveau
script/volume/variable → 10 et README. Un script npm ajouté apparaît dans le
README.

## Architecture : l'API d'abord

- **Toute mutation passe par `/api/v1`** (route handlers `src/app/api/v1/**`),
  jamais par des Server Actions : la même API sert au web (cookie) et servira
  à l'application mobile (`Authorization: Bearer`). Le client web appelle
  l'API via `src/lib/client.ts`.
- **Logique métier dans `src/lib/`** (`projects.ts`, `tasks.ts`, `documents.ts`,
  `dashboard.ts`, `notifications.ts`, `mindmaps.ts`, `auth.ts`, `uploads.ts`) ; les route handlers
  restent minces : validation zod (`src/lib/schemas.ts`) → métier → JSON.
- Les pages serveur lisent directement `src/lib/*` (pas de fetch interne).
- Les mutations d'un projet renvoient **le projet complet recalculé** ; le
  client remplace son état (`ProjectWorkspace.run`). Les mutations de tâche
  renvoient `{ project | null, task }` : projet, étape et activité sont
  **facultatifs** sur une tâche (`resolveAttachment`, `mutateTask`).

- **Notifications** : toute action qui concerne quelqu'un d'autre (affectation,
  modification d'une tâche affectée, réponse, mention) appelle `notify()`
  (`src/lib/notifications.ts`) **dans la transaction** ; jamais l'auteur de
  l'action. Nouveau type ⇒ enum Prisma + icône dans `NotificationsBell` +
  libellé dans `src/lib/shared/notification-types.ts` + `NOTIFICATION_TYPES`
  (`settings.ts`) + schéma zod de l'administration + docs. Les e-mails partent
  **hors transaction** (file `emailState`, `mailer.ts`) : ne jamais appeler
  SMTP dans une transaction ; tout texte inséré dans un e-mail passe par
  `escapeHtml()`.
- **Connecteur MCP** (`src/lib/mcp.ts`, `src/lib/mcp-write.ts`) : outils de
  lecture via les fonctions métier avec `userId` ; l'accès aux données des
  autres exige `admin_access: true` **et** `isAdmin`. Les outils d'écriture
  (clé `canWrite`) passent **par l'API REST en boucle locale** avec une session
  éphémère de l'utilisateur : mêmes droits, validations, notifications et
  audit que l'interface. Jamais d'écriture Prisma directe depuis le MCP.
  Routes sensibles interdites (`FORBIDDEN` : auth, clés, mot de passe,
  e-mail, sync, mcp). Les clés `sb_…` ne valent pas session. Une nouvelle
  route est automatiquement accessible via `api_request` (documentée en 04).
- **Piste d'audit des tâches** (`src/lib/task-events.ts`) : toute écriture sur
  une tâche (champs, personnes, prérequis, rattachement, commentaires, sessions,
  nœuds, risques) enregistre des `TaskEvent` **dans la même transaction**
  (`diffTaskEvents` avant / après, ou `recordTaskEvents`). Nouvelle écriture
  sur une tâche ⇒ l'auditer.
- **Réunions** (`src/lib/meetings.ts`) : seul le rédacteur (ou le propriétaire
  du projet) modifie ; modifier le compte-rendu remet **toutes** les décisions
  à `PENDING` ; HTML assaini ; notifications `MEETING_REVIEW` /
  `MEETING_DECISION`.
- **Messagerie** (`src/lib/messages.ts`) : tout accès passe par
  `requireParticipant` ; HTML assaini à l'écriture et au rendu.

## Graphiques : amCharts 4, toujours

Tout graphique utilise `@amcharts/amcharts4` via l'enveloppe
`src/components/charts/AmChart.tsx` (import dynamique côté client, disposal au
démontage, couleurs du thème résolues par `themeColor()`). Composants
existants : `StatusDonut`, `ProgressBarsChart`, `PlanningChart` (planning des
étapes). Pas de Recharts, Chart.js, d3 custom ni SVG maison pour un graphique.
**Exception assumée (demande de Daniel)** : le **diagramme de Gantt** des
tâches est un composant dédié `src/components/gantt/` (HTML/CSS + SVG pour les
flèches), car amCharts ne permet pas le glisser / redimensionner ni les
connecteurs de Gantt ; logique pure dans `ganttModel.ts` (`npm run test:gantt`).
**Licence amCharts 4** : la même clé partout (`CH214458775` graphiques,
`MP214458775` cartes), appliquée par `applyLicense()` dans `AmChart.tsx`
(`AMCHARTS_LICENSES`) : tout graphique passe par l'enveloppe, jamais
d'`addLicense` ailleurs.

## Sécurité

1. Route authentifiée = `withUser(...)` (`src/lib/api.ts`) ; route publique =
   `withPublic(...)`. Jamais de handler nu (sauf téléchargements binaires, qui
   appellent `getCurrentUser()` eux-mêmes).
2. **Anti-IDOR** : toute fonction métier reçoit `userId` et vérifie l'accès
   (`requireProjectAccess` = propriétaire ou membre rattaché à un compte ;
   `requireProjectOwner` pour supprimer / gérer l'équipe ; `ownedMap` pour les
   cartes ; `taskAccessWhere` / `accessibleTask` pour les tâches, y compris
   sans projet ; `checkNode` pour un nœud de carte). Ne jamais manipuler une
   ressource par id seul. Administration : `requireAdmin(user)` dans chaque
   route `/api/v1/admin/**` et `notFound()` dans les pages `/admin/**` ; le
   rôle admin et la hiérarchie donnent une **lecture seule** (`canEdit: false`),
   jamais un droit d'écriture. Super administrateur : `src/lib/roles.ts`.
   Ne pas importer de constantes ou fonctions d'un module « use client »
   (`ui.tsx`…) dans un composant serveur : passer par un composant client.
3. Validation zod de toute entrée ; bornes sur longueurs et nombres.
4. HTML des notes : `sanitizeNotes()` à l'enregistrement **et** au rendu. Pas
   de `dangerouslySetInnerHTML` sur du contenu non assaini. Jamais de regex à
   la place de `sanitize-html`.
5. Fichiers : allowlist MIME, taille bornée, nom aléatoire, pas de SVG ; accès
   disque borné (`resolveMediaPath`, `resolveDocumentPath`). Les documents de
   projet se téléchargent via une route authentifiée, jamais par URL publique.
6. Prisma uniquement ; `$queryRaw` seulement en template literal paramétré.
7. Secrets uniquement en variables d'environnement (`.env` gitignoré).
8. Sessions opaques en base, cookie `httpOnly` + `sameSite=lax` + `secure` en
   production ; bcrypt coût 12 ; rate limiting sur l'authentification et la
   recherche d'utilisateurs.
9. Les requêtes mutantes authentifiées par cookie vérifient l'en-tête `Origin`
   (fait dans `withUser` / `withPublic`).

## Conventions

- UI en français, **responsive** (mobile-first, Tailwind). Tester en largeur
  mobile : barre latérale → tiroir, panneau de détails → tiroir bas, onglets
  défilants, curseurs sous la ligne de tâche.
- Éditeur riche : `src/components/RichTextEditor.tsx` (collage d'image
  optimiste : aperçu blob immédiat, upload en arrière-plan). Conserver ce
  comportement dans toute évolution.
- Mutations concurrentes : toujours dans `mutateProject` / `mutateMap`
  (verrou de ligne), sinon interblocage PostgreSQL.
- Emoji : `EmojiButton` (`src/components/EmojiPicker.tsx`) dans tout nouvel
  éditeur ou zone de saisie riche.
- Vérifier `npm run typecheck` puis `npm run build` avant de conclure ; tester
  dans le navigateur (dev server) les parcours touchés.

## Synchronisation hors ligne

- Les écritures sont journalisées par le déclencheur PostgreSQL `sb_sync_log`
  (`SyncLog`) : rien à faire dans les fonctions métier. **Nouvelle table
  synchronisée** ⇒ `CREATE TRIGGER` + portée dans la fonction (migration) +
  `src/lib/sync.ts` (fetch, visibilité, opérations) + docs 05.
- Changement incompatible des données synchronisées ou du protocole ⇒
  incrémenter `SYNC_PROTOCOL_VERSION` (les applications demanderont une mise
  à jour) — jamais de compatibilité ascendante.
- Toute évolution touchant tâches, projets ou cartes : relancer
  `npm run test:sync` (serveur de dev lancé) en plus des vérifications
  habituelles. Le site web reste strictement en ligne.

## Application native (`native/`)

- Les écrans de l'application sont les composants du site : une évolution
  d'écran vaut pour les deux. Un composant ne doit dépendre que de `api`
  (`src/lib/client.ts`), de `next/link` / `next/navigation` (remplacés dans
  l'application) et de modules sans `server-only`.
- Règles métier **pures** et constructeurs de DTO : dans `src/lib/shared/`
  (partagés serveur / application). Une nouvelle route `/api/v1` utilisée par
  un écran hors ligne doit exister dans `native/src/local/api.ts` (sinon elle
  est relayée au serveur et indisponible hors ligne).
- **Parité stricte** avec le site (docs/05 § 8 ter) : un écran web nouveau ou
  modifié l'est aussi dans `native/src/App.tsx` (même composition, mêmes
  props) ; une route relayée en ligne doit fonctionner (multipart, lecture
  hors périmètre local) ; un champ dérivé ajouté aux lignes synchronisées ⇒
  incrémenter `LOCAL_DATA_VERSION`.
- Après toute évolution touchant projets, tâches ou cartes : `npm run
  test:native` (serveur de dev lancé) en plus de `test:sync` ; pour la coque,
  `npm run desktop:smoke`.
- **Toute évolution d'écran déployée sur le site doit aussi partir dans une
  nouvelle version desktop** (les écrans sont embarqués : sans nouvelle
  version, l'updater ne voit aucun écart). `prod:deploy` avertit si des écrans
  ont changé depuis la dernière version.
- Nouvelle version de l'application : incrémenter `native/electron/package.json`,
  `npm run desktop:build` puis `npm run desktop:publish`. iPhone : workflow
  GitHub « iOS TestFlight » (manuel) ; `native/ios` est le projet Xcode généré
  par Capacitor (`capacitor.config.ts`), ne modifier que `Info.plist` et l'icône.
- Images de notes : toujours stockées en `/media/…` relatif ; sur iPhone, le
  transport les rend absolues à l'affichage (`native/src/local/platform.ts`).

## Production

- Config dans `.env.deploy` (gitignoré) ; mode d'emploi dans
  `docs/10-deployment.md`.
- **Déployer = `git push` puis `npm run prod:deploy`** : le serveur tire le
  code depuis GitHub. Si `ops/server/provision.sh` change (Caddy, répertoires),
  relancer `npm run prod:setup` (idempotent) avant.
- Commandes nécessitant `scripts/`, `tsx` ou le CLI Prisma :
  `npm run prod:exec -- "…"` (conteneur `tools`).
- Ne jamais éditer le `.env` du serveur à la main :
  `npm run prod:env -- --set CLE=valeur --restart`.
- Le serveur héberge aussi la boutique TCG (`/home/deploy/boutique`,
  port 3000) : ne pas toucher à ses conteneurs ni à son site Caddy.
