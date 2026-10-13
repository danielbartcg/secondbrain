-- Notes riches (HTML) sur projets, étapes, activités et tâches (« Prise de notes »).
ALTER TABLE "Project" ADD COLUMN "notes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Stage" ADD COLUMN "notes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Activity" ADD COLUMN "notes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Task" ADD COLUMN "notes" TEXT NOT NULL DEFAULT '';
