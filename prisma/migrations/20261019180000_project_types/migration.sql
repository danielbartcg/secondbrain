-- CreateTable
CREATE TABLE "ProjectType" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTypeLink" (
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,

    CONSTRAINT "ProjectTypeLink_pkey" PRIMARY KEY ("userId","projectId")
);

-- CreateIndex
CREATE INDEX "ProjectType_userId_order_idx" ON "ProjectType"("userId", "order");

-- CreateIndex
CREATE INDEX "ProjectTypeLink_typeId_idx" ON "ProjectTypeLink"("typeId");

-- AddForeignKey
ALTER TABLE "ProjectType" ADD CONSTRAINT "ProjectType_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTypeLink" ADD CONSTRAINT "ProjectTypeLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTypeLink" ADD CONSTRAINT "ProjectTypeLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTypeLink" ADD CONSTRAINT "ProjectTypeLink_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ProjectType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

