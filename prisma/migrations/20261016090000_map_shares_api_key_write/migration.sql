-- CreateEnum
CREATE TYPE "MapPermission" AS ENUM ('READ', 'WRITE');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'MAP_SHARED';

-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN     "canWrite" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "MindMapShare" (
    "mapId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" "MapPermission" NOT NULL DEFAULT 'READ',
    "sharedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MindMapShare_pkey" PRIMARY KEY ("mapId","userId")
);

-- CreateIndex
CREATE INDEX "MindMapShare_userId_idx" ON "MindMapShare"("userId");

-- AddForeignKey
ALTER TABLE "MindMapShare" ADD CONSTRAINT "MindMapShare_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "MindMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MindMapShare" ADD CONSTRAINT "MindMapShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MindMapShare" ADD CONSTRAINT "MindMapShare_sharedById_fkey" FOREIGN KEY ("sharedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

