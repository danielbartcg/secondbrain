-- CreateEnum
CREATE TYPE "SyncOp" AS ENUM ('UPSERT', 'DELETE');

-- CreateTable
CREATE TABLE "SyncLog" (
    "seq" BIGSERIAL NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT,
    "op" "SyncOp" NOT NULL,
    "projectId" TEXT,
    "mapId" TEXT,
    "ownerId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "AppliedOp" (
    "opId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppliedOp_pkey" PRIMARY KEY ("userId","opId")
);

-- CreateIndex
CREATE INDEX "SyncLog_projectId_seq_idx" ON "SyncLog"("projectId", "seq");

-- CreateIndex
CREATE INDEX "SyncLog_mapId_seq_idx" ON "SyncLog"("mapId", "seq");

-- CreateIndex
CREATE INDEX "SyncLog_ownerId_seq_idx" ON "SyncLog"("ownerId", "seq");

-- CreateIndex
CREATE INDEX "SyncLog_entityId_idx" ON "SyncLog"("entityId");


-- ---------------------------------------------------------------------------
-- Journal de synchronisation alimenté par déclencheur (docs/05-offline-sync.md)
-- Une ligne par création (field NULL), par champ modifié, ou par suppression.
-- La portée (projectId / mapId / ownerId) dit à qui diffuser le changement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sb_sync_log() RETURNS trigger AS $$
DECLARE
  newj jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  oldj jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  rowj jsonb := COALESCE(to_jsonb(NEW), to_jsonb(OLD));
  ent text := TG_TABLE_NAME;
  eid text;
  pid text;
  mid text;
  oid text;
  k text;
BEGIN
  IF TG_OP = 'DELETE' THEN rowj := oldj; ELSE rowj := newj; END IF;

  IF ent = 'MindNodeTask' THEN eid := (rowj->>'nodeId') || ':' || (rowj->>'taskId');
  ELSIF ent = 'TaskContributor' THEN eid := (rowj->>'taskId') || ':' || (rowj->>'memberId');
  ELSE eid := rowj->>'id';
  END IF;

  IF ent = 'MindMap' THEN
    mid := rowj->>'id'; oid := rowj->>'ownerId';
  ELSIF ent = 'MindNode' THEN
    mid := rowj->>'mapId';
    SELECT "ownerId" INTO oid FROM "MindMap" WHERE "id" = mid;
  ELSIF ent = 'MindNodeTask' THEN
    SELECT n."mapId", m."ownerId" INTO mid, oid FROM "MindNode" n JOIN "MindMap" m ON m."id" = n."mapId" WHERE n."id" = rowj->>'nodeId';
  ELSIF ent = 'Project' THEN
    pid := rowj->>'id';
  ELSIF ent IN ('Stage', 'ProjectMember', 'Deliverable', 'Document', 'Folder') THEN
    pid := rowj->>'projectId';
  ELSIF ent = 'Activity' THEN
    SELECT "projectId" INTO pid FROM "Stage" WHERE "id" = rowj->>'stageId';
  ELSIF ent = 'Task' THEN
    pid := rowj->>'projectId'; oid := rowj->>'ownerId';
  ELSIF ent IN ('TaskContributor', 'WorkSession', 'TaskComment') THEN
    SELECT "projectId", "ownerId" INTO pid, oid FROM "Task" WHERE "id" = rowj->>'taskId';
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO "SyncLog" ("entity", "entityId", "field", "op", "projectId", "mapId", "ownerId") VALUES (ent, eid, NULL, 'UPSERT', pid, mid, oid);
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO "SyncLog" ("entity", "entityId", "field", "op", "projectId", "mapId", "ownerId") VALUES (ent, eid, NULL, 'DELETE', pid, mid, oid);
  ELSE
    -- Tâche changée de projet : l'ancienne portée reçoit une suppression.
    IF ent = 'Task' AND (oldj->>'projectId') IS DISTINCT FROM (newj->>'projectId') THEN
      INSERT INTO "SyncLog" ("entity", "entityId", "field", "op", "projectId", "mapId", "ownerId") VALUES (ent, eid, NULL, 'DELETE', oldj->>'projectId', NULL, CASE WHEN oldj->>'projectId' IS NULL THEN oldj->>'ownerId' END);
      INSERT INTO "SyncLog" ("entity", "entityId", "field", "op", "projectId", "mapId", "ownerId") VALUES (ent, eid, NULL, 'UPSERT', pid, mid, oid);
    END IF;
    FOR k IN SELECT jsonb_object_keys(newj) LOOP
      IF k NOT IN ('updatedAt', 'createdAt') AND (newj->k) IS DISTINCT FROM (oldj->k) THEN
        INSERT INTO "SyncLog" ("entity", "entityId", "field", "op", "projectId", "mapId", "ownerId") VALUES (ent, eid, k, 'UPSERT', pid, mid, oid);
      END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sb_sync AFTER INSERT OR UPDATE OR DELETE ON "MindMap" FOR EACH ROW EXECUTE FUNCTION sb_sync_log();
CREATE TRIGGER sb_sync AFTER INSERT OR UPDATE OR DELETE ON "MindNode" FOR EACH ROW EXECUTE FUNCTION sb_sync_log();
CREATE TRIGGER sb_sync AFTER INSERT OR UPDATE OR DELETE ON "MindNodeTask" FOR EACH ROW EXECUTE FUNCTION sb_sync_log();
CREATE TRIGGER sb_sync AFTER INSERT OR UPDATE OR DELETE ON "Project" FOR EACH ROW EXECUTE FUNCTION sb_sync_log();
CREATE TRIGGER sb_sync AFTER INSERT OR UPDATE OR DELETE ON "ProjectMember" FOR EACH ROW EXECUTE FUNCTION sb_sync_log();
CREATE TRIGGER sb_sync AFTER INSERT OR UPDATE OR DELETE ON "Stage" FOR EACH ROW EXECUTE FUNCTION sb_sync_log();
CREATE TRIGGER sb_sync AFTER INSERT OR UPDATE OR DELETE ON "Activity" FOR EACH ROW EXECUTE FUNCTION sb_sync_log();
CREATE TRIGGER sb_sync AFTER INSERT OR UPDATE OR DELETE ON "Task" FOR EACH ROW EXECUTE FUNCTION sb_sync_log();
CREATE TRIGGER sb_sync AFTER INSERT OR UPDATE OR DELETE ON "TaskContributor" FOR EACH ROW EXECUTE FUNCTION sb_sync_log();
CREATE TRIGGER sb_sync AFTER INSERT OR UPDATE OR DELETE ON "WorkSession" FOR EACH ROW EXECUTE FUNCTION sb_sync_log();
CREATE TRIGGER sb_sync AFTER INSERT OR UPDATE OR DELETE ON "TaskComment" FOR EACH ROW EXECUTE FUNCTION sb_sync_log();
CREATE TRIGGER sb_sync AFTER INSERT OR UPDATE OR DELETE ON "Deliverable" FOR EACH ROW EXECUTE FUNCTION sb_sync_log();
CREATE TRIGGER sb_sync AFTER INSERT OR UPDATE OR DELETE ON "Document" FOR EACH ROW EXECUTE FUNCTION sb_sync_log();
CREATE TRIGGER sb_sync AFTER INSERT OR UPDATE OR DELETE ON "Folder" FOR EACH ROW EXECUTE FUNCTION sb_sync_log();
