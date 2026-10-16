-- CreateTable
CREATE TABLE "MapEvent" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "nodeId" TEXT,
    "nodeTitle" TEXT,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MapEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MapEvent_mapId_createdAt_idx" ON "MapEvent"("mapId", "createdAt");

-- CreateIndex
CREATE INDEX "MapEvent_createdAt_idx" ON "MapEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "MapEvent" ADD CONSTRAINT "MapEvent_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "MindMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapEvent" ADD CONSTRAINT "MapEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

