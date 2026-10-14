/**
 * Types de la couche hors ligne de l'application native
 * (docs/05-offline-sync.md). Les lignes locales ont exactement les colonnes
 * renvoyées par GET /api/v1/sync/pull (dates en ISO).
 */

export const SYNC_PROTOCOL = 1;

export const ENTITIES = [
  "MindMap",
  "MindNode",
  "MindNodeTask",
  "Project",
  "ProjectMember",
  "Stage",
  "Activity",
  "Task",
  "TaskContributor",
  "WorkSession",
  "TaskComment",
  "Deliverable",
  "Document",
  "Folder",
] as const;
export type Entity = (typeof ENTITIES)[number];

/** Entités modifiables hors ligne (les autres sont en lecture seule). */
export const WRITABLE: ReadonlySet<Entity> = new Set<Entity>([
  "MindMap",
  "MindNode",
  "MindNodeTask",
  "Project",
  "Stage",
  "Activity",
  "Task",
  "TaskContributor",
  "WorkSession",
  "TaskComment",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
export type FieldSeqs = Record<string, number>;
export type RowRec = { data: Row; seqs: FieldSeqs };

export type OpKind = "create" | "update" | "delete";
export type Op = {
  opId: string;
  entity: Entity;
  id: string;
  op: OpKind;
  fields?: Row;
  base?: FieldSeqs;
  /** Libellé lisible (titre de l'objet) pour les messages de conflit. */
  label?: string;
  createdAt: string;
};

export type ConflictEntry = {
  id: string;
  at: string;
  entity: Entity;
  entityId: string;
  label: string;
  /** Champ concerné ; "*" = l'objet entier (suppression). */
  field: string;
  kind: "overwritten" | "deleted-on-server" | "delete-refused" | "rejected";
  /** Votre valeur, écrasée par celle du serveur. */
  localValue: unknown;
  serverValue: unknown;
  message?: string;
};

export type Profile = {
  id: string;
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  theme: string;
  role: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  managerId: string | null;
  reportCount: number;
  createdAt: string;
};

export type Meta = {
  serverUrl: string;
  token: string | null;
  user: Profile | null;
  cursor: number;
  lastSyncAt: string | null;
  /** Ordre personnel « Mes tâches » (non synchronisé : conservé localement). */
  ranks: string[];
};

export type SyncStatus = {
  online: boolean;
  syncing: boolean;
  pending: number;
  conflicts: number;
  lastSyncAt: string | null;
  lastError: string | null;
  /** L'application n'est plus compatible avec le serveur : mise à jour obligatoire. */
  upgradeRequired: boolean;
  /** Le jeton n'est plus valide : reconnexion nécessaire. */
  signedOut: boolean;
  /** Des changements venus du serveur sont arrivés depuis l'affichage de l'écran. */
  remoteChanges: number;
};
