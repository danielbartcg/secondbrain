-- Date de clôture des tâches (reprise : dernière modification des tâches déjà clôturées).
ALTER TABLE "Task" ADD COLUMN "closedAt" TIMESTAMP(3);
UPDATE "Task" SET "closedAt" = "updatedAt" WHERE "status" = 'CLOSED';
