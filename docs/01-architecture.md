# Architecture

## Vue d'ensemble

```
Navigateur (web responsive)            Application mobile (à venir)
   │ cookie `session`                      │ Authorization: Bearer <token>
   ▼                                       ▼
┌──────────────────────── Next.js 15 (App Router) ────────────────────────┐
│  Pages serveur  ──lit──▶  src/lib/* (métier)  ◀──appelle──  /api/v1/*  │
│  (dashboard, listes)      auth · mindmaps · projects · uploads          │
│                                     │ Prisma                            │
└─────────────────────────────────────┼───────────────────────────────────┘
                                      ▼
                               PostgreSQL 16          data/uploads (images)
```

- **Une seule source de vérité métier** : `src/lib/`. Les route handlers
  `/api/v1` sont de simples adaptateurs HTTP (validation zod → métier →
  JSON). Les pages serveur lisent directement le métier (pas de fetch vers
  soi-même) ; les composants client mutent via `src/lib/client.ts` → API.
- **Pas de Server Actions** : tout ce que fait le web est faisable par un
  client externe. C'est la condition pour l'application mobile.
- **Contrats typés** : les DTO (`MindMapDto`, `ProjectDto`…) sont définis dans
  `src/lib/*.ts` et importés par les composants (types uniquement) — le JSON
  de l'API est exactement ce que voit l'interface.

## Authentification

- E-mail + mot de passe (bcrypt coût 12). Sessions **opaques** en base
  (`Session.token`, 256 bits), 90 jours.
- Web : cookie `session` HTTP-only, `SameSite=Lax`, `Secure` en production.
- Mobile : même jeton en `Authorization: Bearer`. Le header est prioritaire
  sur le cookie.
- Anti-CSRF : les requêtes mutantes authentifiées par cookie doivent porter
  un `Origin` égal à l'hôte (`src/lib/api.ts`). Les clients Bearer n'ont pas
  de cookie, donc pas de CSRF possible.
- Rate limiting en mémoire (10 / 15 min / IP) sur `login` et `register`.
- `ALLOW_REGISTRATION=false` ferme l'inscription publique ; les comptes se
  créent alors avec `scripts/create-user.ts`.

## Cartes mentales

- Stockage : arbre plat (`MindNode.parentId`, `order`), une racine par carte
  (`parentId = null`). La suppression cascade.
- Notes : HTML TipTap, **assaini à l'écriture et à la lecture**
  (`src/lib/sanitize.ts`). Images autorisées uniquement en `/media/…` ou
  `http(s)://`.
- Mise en page : **côté client**, `src/lib/mindmap-layout.ts` (d3-hierarchy,
  sans React) — racine au centre, branches de niveau 1 alternées droite /
  gauche, colonnes dimensionnées selon la largeur estimée des titres. Le
  module est réutilisable tel quel dans l'application mobile.
- Rendu : React Flow (`@xyflow/react`), nœuds personnalisés, arêtes Bézier
  colorées comme le nœud enfant. Positions imposées par la mise en page ;
  le glisser sert uniquement à **rattacher** une branche à un autre nœud.
- Concurrence : toute mutation d'une carte verrouille la ligne `MindMap`
  (`SELECT … FOR UPDATE`) dans une transaction ; le client sérialise aussi
  ses envois (file d'attente). Sans cela, « renommer » + « ajouter un enfant »
  envoyés coup sur coup provoquaient un interblocage PostgreSQL.

## Gestion de projet

- Hiérarchie : `Project › Stage › Activity? › Task`. `Task.activityId` est
  nullable : une tâche peut dépendre directement de l'étape.
- L'avancement n'existe **que sur les tâches** (`progress` 0–100, `status`).
  `reconcile()` garantit la cohérence (DONE ⇔ 100, TODO ⇔ 0). Les niveaux
  supérieurs sont calculés à la volée (`aggregate()`) : moyenne des tâches,
  nombre de terminées. Rien n'est dénormalisé.
- Toute mutation renvoie le projet complet recalculé : le client remplace son
  état, aucune logique d'agrégation côté client.
- Même stratégie de verrou (ligne `Project`) que pour les cartes.

## Uploads

Images collées dans les notes : `POST /api/v1/uploads` (allowlist MIME, 10 Mo,
nom aléatoire 128 bits), servies par `/media/[...path]` sans authentification
(URL = capacité). Répertoire `DATA_DIR/uploads`, monté en volume Docker et
inclus dans les sauvegardes.

## Interface

- Tailwind CSS 4, thème dans `src/app/globals.css` (`@theme`).
- Responsive : barre latérale ≥ `md`, tiroir mobile sinon ; dans l'éditeur de
  carte, le panneau de détails devient un tiroir bas sur mobile ; les
  curseurs d'avancement passent sous la ligne de tâche.
- Éditeur riche partagé : `src/components/RichTextEditor.tsx` (repris du
  template boutique) — collage d'image **optimiste** : aperçu blob immédiat,
  upload en arrière-plan, remplacement de l'URL ; la sauvegarde des notes est
  différée tant qu'une URL `blob:` est présente.
