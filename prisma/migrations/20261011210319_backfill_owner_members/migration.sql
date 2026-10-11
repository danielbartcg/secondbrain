-- Rétro-remplissage : le propriétaire de chaque projet existant devient
-- membre de son équipe (comme pour tout projet créé désormais).
INSERT INTO "ProjectMember" ("id", "projectId", "userId", "name", "email", "role", "createdAt")
SELECT
  'pm_' || md5(p."id" || ':' || p."ownerId"),
  p."id",
  p."ownerId",
  u."name",
  u."email",
  'Chef de projet',
  NOW()
FROM "Project" p
JOIN "User" u ON u."id" = p."ownerId"
WHERE NOT EXISTS (
  SELECT 1 FROM "ProjectMember" m WHERE m."projectId" = p."id" AND m."userId" = p."ownerId"
);
