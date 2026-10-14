# Hors ligne et synchronisation (conception — non implémenté)

> Statut : **phase 1 (socle serveur) implémentée** — `src/lib/sync.ts`,
> `/api/v1/sync/*`, migration `20261014220000_sync_log`, tests
> `npm run test:sync`. Phases 2 à 4 en cours. Décisions prises avec Daniel le
> 14/10/2026 :
> interface web embarquée dans une coque native ; **modification** hors ligne ;
> conflits **par champ**, le serveur gagne et l'utilisateur est notifié ;
> périmètre hors ligne = **projets et cartes mentales** (pas les fichiers des
> documents) ; diffusion **TestFlight** et installateur direct, stores plus
> tard ; ordre : **socle de synchro**, puis **desktop**, puis **iPhone**.

## 1. Architecture cible

```
┌──────────── Application (desktop Tauri / iPhone Capacitor) ────────────┐
│  Interface React existante (cartes, Kanban, fiche tâche, éditeur riche) │
│        │ lit / écrit                                                    │
│  Magasin local (SQLite)  ◄──── pull : changements depuis le curseur ──┐ │
│        │                                                              │ │
│  File d'attente (outbox) ───── push : mutations + versions de base ──►│ │
└───────────────────────────────────────────────────────────────────────┼─┘
                                                                        ▼
                         API /api/v1/sync (Next.js) ─► logique métier src/lib ─► PostgreSQL
```

- Le web reste tel quel (en ligne, rendu serveur). Les applications utilisent
  un **build « app »** du même code, rendu côté client, qui lit un magasin
  local au lieu de l'API. Une interface `DataSource` unique masque la
  différence (en ligne : API ; app : SQLite + synchro).
- Toutes les écritures synchronisées repassent par les **fonctions métier
  existantes** (`updateTask`, `reconcile`, contrôles d'accès, notifications) :
  une seule source de règles.

## 2. Périmètre synchronisé

| Synchronisé hors ligne (lecture + écriture) | Lecture seule hors ligne | Non disponible hors ligne |
| --- | --- | --- |
| Cartes, nœuds (titre, notes, statut, couleur, position, repli), liens nœud ↔ tâche ; projets, étapes, activités, tâches (tous champs, contributeurs, sessions de travail), notes des objets, commentaires (ajout) | Équipe des projets, livrables, liste des documents | Contenu des fichiers documents, notifications, administration, recherche serveur (remplacée par une recherche locale) |

## 3. Côté serveur

**Schéma** (tables synchronisées : `MindMap`, `MindNode`, `MindNodeTask`,
`Project`, `Stage`, `Activity`, `Task`, `TaskContributor`, `WorkSession`,
`TaskComment`) :
- `SyncLog` : journal global à numéro croissant (`seq` BIGSERIAL) — une ligne
  par champ modifié ou par suppression : `seq, entity, entityId, field | null,
  op (UPSERT | DELETE), projectId?, mapId?, at, userId`. Sert de **curseur** de
  synchro et de **version par champ** (le `seq` de la dernière écriture d'un
  champ).
- `AppliedOp` : identifiants des opérations déjà appliquées (idempotence des
  renvois après coupure).
- Création hors ligne : les identifiants (cuid) sont **générés par le client**
  et acceptés par l'API.

**Points d'API**
- `GET /sync/pull?cursor=N` → enregistrements modifiés et suppressions depuis
  `N`, filtrés par les accès de l'utilisateur, par pages ; nouveau curseur.
  Premier lancement : instantané complet du périmètre.
- `POST /sync/push { ops: [{ opId, entity, id, op, fields: {champ: valeur},
  base: {champ: seq} }] }` → pour chaque opération : `applied`, ou
  `conflict` avec les champs refusés et leurs valeurs serveur.

**Règle de conflit (par champ)** : un champ est appliqué si son `seq` serveur
est égal au `base` envoyé (personne ne l'a modifié depuis la lecture) ; sinon
la valeur serveur est conservée et le champ est renvoyé en conflit. Les autres
champs de la même opération sont appliqués normalement.

## 4. Côté application

- **Magasin local SQLite** : mêmes tables que le serveur + `seq` par champ +
  curseur de synchro + outbox.
- **Outbox** : chaque action enregistre une opération (avec `opId` et les
  `base` des champs touchés) et met à jour le magasin local immédiatement
  (interface instantanée, comme aujourd'hui).
- **Synchro** : au démarrage, au retour du réseau, toutes les 30 s en ligne et
  après chaque écriture : push de l'outbox dans l'ordre, puis pull.
- **Conflits** : notification « Les valeurs les plus récentes proviennent du
  serveur : vos modifications sur … ont été écrasées », avec le détail
  (objet, champ, votre valeur, valeur retenue).
- **Images collées hors ligne** : conservées localement, téléversées à la
  reconnexion, puis l'URL `blob:` est remplacée dans les notes.
- **Authentification** : jeton Bearer (déjà supporté) rangé dans le trousseau
  du système ; l'application reste utilisable hors ligne avec le jeton en
  cache ; reconnexion demandée seulement en ligne si le jeton a expiré.

## 5. Coques natives

- **Desktop** : Tauri 2 (Windows, macOS), SQLite via le plugin officiel,
  installateur direct, mises à jour automatiques.
- **iPhone** : Capacitor (WebView + SQLite natif), distribution TestFlight
  (compte Apple Developer, 99 $/an). Ajustements tactiles : carte mentale
  (pincer-zoomer, appui long pour déplacer), Kanban (menu « … » déjà présent).
- **Pour les stores plus tard** : l'App Store impose notamment la
  **suppression du compte depuis l'application** et une politique de
  confidentialité ; à prévoir avant la publication.

## 6. Phasage

| Phase | Contenu | Vérification |
| --- | --- | --- |
| 1. Socle serveur | `SyncLog`, `AppliedOp`, identifiants client, `pull` / `push`, conflits par champ, périmètre d'accès | Tests automatisés (Vitest) : scénarios hors ligne, conflits, suppressions, renvois |
| 2. Client hors ligne | `DataSource`, magasin local, outbox, synchro, notifications de conflit, build « app » ; testable d'abord dans un navigateur | Coupures réseau simulées, deux clients concurrents |
| 3. Desktop | Coque Tauri, trousseau, installateur, mises à jour | Installation Windows, hors ligne réel |
| 4. iPhone | Coque Capacitor, ergonomie tactile, TestFlight | Tests sur appareil |

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
