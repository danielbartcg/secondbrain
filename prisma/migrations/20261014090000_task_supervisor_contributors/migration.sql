-- Superviseur (un membre) et contributeurs (plusieurs membres) d'une tâche.
ALTER TABLE "Task" ADD COLUMN "supervisorId" TEXT;
CREATE INDEX "Task_supervisorId_idx" ON "Task"("supervisorId");
ALTER TABLE "Task" ADD CONSTRAINT "Task_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "ProjectMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TaskContributor" (
    "taskId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskContributor_pkey" PRIMARY KEY ("taskId","memberId")
);
CREATE INDEX "TaskContributor_memberId_idx" ON "TaskContributor"("memberId");
ALTER TABLE "TaskContributor" ADD CONSTRAINT "TaskContributor_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskContributor" ADD CONSTRAINT "TaskContributor_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ProjectMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
