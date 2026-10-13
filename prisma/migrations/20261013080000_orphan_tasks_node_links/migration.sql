-- Tâches : projet / étape facultatifs, propriétaire explicite, rattachement aux nœuds de carte.

-- AlterTable (colonnes d'abord nullables pour permettre la reprise des données)
ALTER TABLE "Task" ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "projectId" TEXT,
ALTER COLUMN "stageId" DROP NOT NULL;

-- Reprise : projet déduit de l'étape, propriétaire = propriétaire du projet.
UPDATE "Task" t SET "projectId" = s."projectId" FROM "Stage" s WHERE t."stageId" = s."id";
UPDATE "Task" t SET "ownerId" = p."ownerId" FROM "Project" p WHERE t."projectId" = p."id";

ALTER TABLE "Task" ALTER COLUMN "ownerId" SET NOT NULL;

-- CreateTable
CREATE TABLE "MindNodeTask" (
    "nodeId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MindNodeTask_pkey" PRIMARY KEY ("nodeId","taskId")
);

-- CreateIndex
CREATE INDEX "MindNodeTask_taskId_idx" ON "MindNodeTask"("taskId");

-- CreateIndex
CREATE INDEX "Task_ownerId_idx" ON "Task"("ownerId");

-- CreateIndex
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MindNodeTask" ADD CONSTRAINT "MindNodeTask_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "MindNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MindNodeTask" ADD CONSTRAINT "MindNodeTask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
