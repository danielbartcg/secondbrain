-- ---------------------------------------------------------------------------
-- Partage des cartes mentales : la table "MindMapShare" est synchronisée
-- (lecture seule côté application) avec la portée de sa carte (mapId), pour
-- que les applications connaissent le droit (lecture / écriture) hors ligne.
-- Identifiant composite « mapId:userId ». La fonction est redéfinie à
-- l'identique de 20261014220000_sync_log, avec la branche MindMapShare.
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
  ELSIF ent = 'MindMapShare' THEN eid := (rowj->>'mapId') || ':' || (rowj->>'userId');
  ELSE eid := rowj->>'id';
  END IF;

  IF ent = 'MindMap' THEN
    mid := rowj->>'id'; oid := rowj->>'ownerId';
  ELSIF ent = 'MindNode' THEN
    mid := rowj->>'mapId';
    SELECT "ownerId" INTO oid FROM "MindMap" WHERE "id" = mid;
  ELSIF ent = 'MindMapShare' THEN
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

CREATE TRIGGER sb_sync AFTER INSERT OR UPDATE OR DELETE ON "MindMapShare" FOR EACH ROW EXECUTE FUNCTION sb_sync_log();
