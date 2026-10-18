-- AlterTable
ALTER TABLE "User" ADD COLUMN     "staleDays" INTEGER NOT NULL DEFAULT 14;

-- CreateTable
CREATE TABLE "ProjectBaseline" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "taskCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectBaseline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResurfaceCard" (
    "userId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "box" INTEGER NOT NULL DEFAULT 1,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "lastReviewedAt" TIMESTAMP(3),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResurfaceCard_pkey" PRIMARY KEY ("userId","ref")
);

-- CreateTable
CREATE TABLE "CalendarFeed" (
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "CalendarFeed_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "ProjectBaseline_projectId_createdAt_idx" ON "ProjectBaseline"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ResurfaceCard_userId_dueAt_idx" ON "ResurfaceCard"("userId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarFeed_tokenHash_key" ON "CalendarFeed"("tokenHash");

-- AddForeignKey
ALTER TABLE "ProjectBaseline" ADD CONSTRAINT "ProjectBaseline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBaseline" ADD CONSTRAINT "ProjectBaseline_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResurfaceCard" ADD CONSTRAINT "ResurfaceCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarFeed" ADD CONSTRAINT "CalendarFeed_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

