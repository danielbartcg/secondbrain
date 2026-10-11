# Instructions pour Claude Code — Second Brain

## Architecture : l'API d'abord

- **Toute mutation passe par `/api/v1`** (route handlers `src/app/api/v1/**`),
  jamais par des Server Actions : la même API sert au web (cookie) et servira
  à l'application mobile (`Authorization: Bearer`). Le client web appelle
  l'API via `src/lib/client.ts`.
- **Logique métier dans `src/lib/`** (`mindmaps.ts`, `projects.ts`, `auth.ts`,
  `uploads.ts`) ; les route handlers restent minces : validation zod
  (`src/lib/schemas.ts`) → appel métier → JSON.
- Les pages serveur lisent directement `src/lib/*` (pas de fetch interne).
- Tout nouvel endpoint ou champ doit être documenté dans `docs/04-api.md`,
  tout changement de `prisma/schema.prisma` dans `docs/02-data-model.md`.

## Sécurité

1. Route authentifiée = `withUser(...)` (`src/lib/api.ts`) ; route publique =
   `withPublic(...)`. Jamais de handler nu.
2. **Anti-IDOR** : toute fonction métier reçoit `userId` et vérifie la
   propriété de la ressource (`ownedMap`, `ownedProject`, `ownedStage`…) avant
   d'agir. Ne jamais manipuler une ressource par id seul.
3. Validation zod de toute entrée ; bornes sur longueurs et nombres.
4. HTML des notes : `sanitizeNotes()` (`src/lib/sanitize.ts`) à
   l'enregistrement **et** au rendu. Pas de `dangerouslySetInnerHTML` sur du
   contenu non assaini. Ne jamais remplacer `sanitize-html` par des regex.
5. Uploads : allowlist MIME, taille bornée, nom aléatoire, pas de SVG ; accès
   disque borné par `resolveMediaPath`.
6. Prisma uniquement ; pas de SQL concaténé.
7. Secrets uniquement en variables d'environnement (`.env` gitignoré).
8. Sessions opaques en base, cookie `httpOnly` + `sameSite=lax` + `secure` en
   production ; bcrypt coût 12 ; rate limiting sur l'authentification.
9. Les requêtes mutantes authentifiées par cookie vérifient l'en-tête `Origin`
   (fait dans `withUser` / `withPublic`).

## Conventions

- UI en français, **responsive** (mobile-first, Tailwind). Tester les écrans
  en largeur mobile : barre latérale → tiroir, panneau de détails → tiroir bas.
- Éditeur riche : `src/components/RichTextEditor.tsx` (collage d'image
  optimiste : aperçu blob immédiat, upload en arrière-plan). Conserver ce
  comportement dans toute évolution.
- Vérifier `npm run typecheck` puis `npm run build` avant de conclure.

## Production

- Config dans `.env.deploy` (gitignoré) ; mode d'emploi dans
  `docs/10-deployment.md`.
- **Déployer = `git push` puis `npm run prod:deploy`** : le serveur tire le
  code depuis GitHub.
- Commandes nécessitant `scripts/`, `tsx` ou le CLI Prisma :
  `npm run prod:exec -- "…"` (conteneur `tools`).
- Ne jamais éditer le `.env` du serveur à la main :
  `npm run prod:env -- --set CLE=valeur --restart`.
- Le serveur héberge aussi la boutique TCG (`/home/deploy/boutique`,
  port 3000) : ne pas toucher à ses conteneurs ni à son site Caddy.
