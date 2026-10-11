# API REST `/api/v1`

Contrat consommé par le client web et, demain, par l'application mobile.

## Conventions

- JSON partout (`Content-Type: application/json`), sauf l'upload (multipart).
- **Authentification** : jeton de session opaque, obtenu par `login` /
  `register`.
  - Web : posé automatiquement en cookie HTTP-only `session`.
  - Mobile : conserver `token` et l'envoyer en `Authorization: Bearer <token>`
    (prioritaire sur le cookie). Durée de vie : 90 jours.
- **Erreurs** : `{ "error": { "code", "message", "details?" } }`
  - `400 BAD_REQUEST` / `400 VALIDATION` (`details` = `zod.flatten()`)
  - `401 UNAUTHENTICATED`, `401 INVALID_CREDENTIALS`
  - `403 FORBIDDEN`, `403 CSRF`, `403 REGISTRATION_CLOSED`
  - `404 NOT_FOUND`, `409 EMAIL_TAKEN`, `413 TOO_LARGE`, `415 UNSUPPORTED_TYPE`,
    `429 RATE_LIMITED`, `500 INTERNAL`
- Anti-CSRF : une requête mutante authentifiée **par cookie** doit porter un
  en-tête `Origin` égal à l'hôte. Les clients Bearer ne sont pas concernés.
- Dates : ISO 8601 (`2026-10-11T00:00:00.000Z`) ; en entrée, `AAAA-MM-JJ`
  est accepté ; `null` efface.
- Couleurs : `#rrggbb` ou `null`.

## Authentification

| Méthode | Route | Corps | Réponse |
| --- | --- | --- | --- |
| POST | `/auth/register` | `{ email, password (≥ 8), name, client? }` | `201 { user, token, expiresAt }` |
| POST | `/auth/login` | `{ email, password, client? }` | `{ user, token, expiresAt }` |
| POST | `/auth/logout` | — | `{ ok: true }` (révoque la session courante) |
| GET | `/auth/me` | — | `{ user: { id, email, name, createdAt } }` |

`client` est un libellé libre (« iPhone de Daniel ») stocké sur la session.
Rate limiting : 10 tentatives / 15 min / IP sur `register` et `login`.

## Cartes mentales

```ts
type MindNode = {
  id: string; parentId: string | null; title: string;
  notes: string;          // HTML assaini
  color: string | null; collapsed: boolean; order: number; updatedAt: string;
};
type MindMap = { id; title; createdAt; updatedAt; rootId: string; nodes: MindNode[] };
```

| Méthode | Route | Corps | Réponse |
| --- | --- | --- | --- |
| GET | `/mindmaps` | — | `{ mindmaps: [{ id, title, nodeCount, createdAt, updatedAt }] }` |
| POST | `/mindmaps` | `{ title }` | `201 { mindmap }` (racine créée) |
| GET | `/mindmaps/:id` | — | `{ mindmap }` (tous les nœuds, à plat) |
| PATCH | `/mindmaps/:id` | `{ title? }` | `{ mindmap }` |
| DELETE | `/mindmaps/:id` | — | `{ ok: true }` |
| POST | `/mindmaps/:id/nodes` | `{ parentId, title?, index? }` | `201 { node }` |
| PATCH | `/mindmaps/:id/nodes/:nodeId` | `{ title?, notes?, color?, collapsed? }` | `{ node }` |
| DELETE | `/mindmaps/:id/nodes/:nodeId` | — | `{ ok: true }` (branche entière ; racine interdite) |
| POST | `/mindmaps/:id/nodes/:nodeId/move` | `{ parentId, index? }` | `{ node }` (refus si cible dans la branche déplacée) |

L'arbre se reconstruit côté client à partir de `parentId` + `order`. La mise
en page est purement cliente (`src/lib/mindmap-layout.ts`, sans dépendance
React : réutilisable en mobile).

## Projets

```ts
type Progress = { percent: number; total: number; done: number };
type Task = { id; stageId; activityId: string | null; name; description;
              status: "TODO" | "IN_PROGRESS" | "DONE"; progress: 0..100;
              order; dueDate: string | null; updatedAt };
type Activity = { id; stageId; name; description; order; progress; tasks: Task[] };
type Stage = { id; projectId; name; description; order; startDate; dueDate;
               progress; activities: Activity[]; tasks: Task[] /* sans activité */ };
type Project = { id; name; description; color; status: "ACTIVE"|"ON_HOLD"|"DONE"|"ARCHIVED";
                 startDate; dueDate; progress; stageCount; createdAt; updatedAt; stages: Stage[] };
```

Toute mutation sur une étape, une activité ou une tâche **renvoie le projet
complet recalculé** (`{ project }`) : le client remplace son état, les
avancements agrégés sont toujours justes.

| Méthode | Route | Corps |
| --- | --- | --- |
| GET | `/projects` | → `{ projects: ProjectSummary[] }` (sans `stages`) |
| POST | `/projects` | `{ name, description?, color?, status?, startDate?, dueDate? }` |
| GET | `/projects/:id` | → `{ project }` |
| PATCH | `/projects/:id` | champs du POST, tous optionnels |
| DELETE | `/projects/:id` | → `{ ok: true }` |
| POST | `/projects/:id/stages` | `{ name, description?, startDate?, dueDate? }` |
| PATCH | `/stages/:id` | `{ name?, description?, startDate?, dueDate?, order? }` |
| DELETE | `/stages/:id` | |
| POST | `/stages/:id/activities` | `{ name, description? }` |
| POST | `/stages/:id/tasks` | tâche **directement sous l'étape** |
| PATCH | `/activities/:id` | `{ name?, description?, order? }` |
| DELETE | `/activities/:id` | |
| POST | `/activities/:id/tasks` | tâche sous une activité |
| PATCH | `/tasks/:id` | `{ name?, description?, status?, progress?, dueDate?, order?, activityId?, stageId? }` |
| DELETE | `/tasks/:id` | |

Corps d'une tâche à la création : `{ name, description?, status?, progress?, dueDate? }`.

Cohérence statut / avancement (serveur, `reconcile()`) :
`progress = 100 ⇒ DONE`, `progress = 0 ⇒ TODO`, sinon `IN_PROGRESS` ;
`status = DONE ⇒ 100`, `status = TODO ⇒ 0`, `status = IN_PROGRESS` sans
avancement cohérent ⇒ 50.

Déplacement d'une tâche : `activityId: "<id>"` la place sous cette activité
(même projet), `activityId: null` + `stageId?` la rattache directement à
l'étape. `order` renumérote les frères.

## Uploads et médias

| Méthode | Route | Corps | Réponse |
| --- | --- | --- | --- |
| POST | `/uploads` | `multipart/form-data`, champ `file` (JPEG/PNG/GIF/WebP, ≤ 10 Mo) | `201 { url: "/media/AAAA/MM/<aléatoire>.ext" }` |
| GET | `/media/…` (hors `/api`) | — | l'image, cache immuable 1 an |

Les URL de médias sont non devinables (128 bits) et servies sans
authentification : les balises `<img>` des notes fonctionnent sur tous les
clients. Les notes n'acceptent que des `src` en `/media/…` ou `http(s)://`
(jamais `blob:` ni `data:`).
