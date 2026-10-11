# Modèle de données

Source : `prisma/schema.prisma`. Base PostgreSQL. Identifiants `cuid`.
Toutes les relations enfant → parent sont en `onDelete: Cascade`.

## Comptes

| Modèle | Champs | Notes |
| --- | --- | --- |
| `User` | `id`, `email` (unique), `passwordHash`, `name`, `createdAt`, `updatedAt` | propriétaire des cartes et des projets |
| `Session` | `id`, `token` (unique, 256 bits), `userId`, `label?`, `expiresAt`, `createdAt` | jeton unique cookie **et** Bearer ; `label` = client (« Web », « iPhone ») |

## Cartes mentales

| Modèle | Champs | Notes |
| --- | --- | --- |
| `MindMap` | `id`, `ownerId`, `title`, `createdAt`, `updatedAt` | `title` = titre du nœud racine (synchronisés) |
| `MindNode` | `id`, `mapId`, `parentId?`, `title`, `notes` (HTML), `color?`, `collapsed`, `order`, `createdAt`, `updatedAt` | `parentId = null` ⇔ racine (une par carte) ; `order` renuméroté 0..n-1 parmi les frères à chaque mutation |

`notes` est stocké déjà assaini et ré-assaini au rendu (défense en profondeur).

## Projets

```
Project 1───n Stage 1───n Activity 1───n Task
                 └──────────────n Task (activityId = null)
```

| Modèle | Champs | Notes |
| --- | --- | --- |
| `Project` | `id`, `ownerId`, `name`, `description`, `color?`, `status` (`ACTIVE` · `ON_HOLD` · `DONE` · `ARCHIVED`), `startDate?`, `dueDate?`, timestamps | |
| `Stage` | `id`, `projectId`, `name`, `description`, `order`, `startDate?`, `dueDate?`, timestamps | étape |
| `Activity` | `id`, `stageId`, `name`, `description`, `order`, timestamps | niveau intermédiaire **facultatif** |
| `Task` | `id`, `stageId`, `activityId?`, `name`, `description`, `status` (`TODO` · `IN_PROGRESS` · `DONE`), `progress` (0–100), `order`, `dueDate?`, timestamps | `stageId` toujours renseigné, même sous une activité (cohérence : `activity.stageId === task.stageId`) |

Invariants maintenus par `src/lib/projects.ts` :

- `status = DONE ⇔ progress = 100`, `status = TODO ⇔ progress = 0`
  (`reconcile()`).
- Les avancements des activités, étapes et projets ne sont **pas stockés** :
  ils sont agrégés à la lecture (`aggregate()` : moyenne, total, terminées).
- `order` est renuméroté parmi les frères (`stageId` + `activityId` pour les
  tâches) à chaque création, déplacement ou suppression.

## Migrations

`prisma/migrations/` est versionné. En développement : `npx prisma migrate dev`.
En production, `npm run prod:deploy` exécute `prisma migrate deploy` dans le
conteneur `tools` **avant** de démarrer la nouvelle version de l'application.
