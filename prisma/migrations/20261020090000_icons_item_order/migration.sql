-- AlterTable
ALTER TABLE "MindMap" ADD COLUMN     "icon" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "icon" TEXT;

-- CreateTable
CREATE TABLE "ItemOrder" (
    "userId" TEXT NOT NULL,
    "kind" "PinKind" NOT NULL,
    "targetId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,

    CONSTRAINT "ItemOrder_pkey" PRIMARY KEY ("userId","kind","targetId")
);

-- CreateTable
CREATE TABLE "UserIcon" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserIcon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserIcon_userId_url_key" ON "UserIcon"("userId", "url");

-- AddForeignKey
ALTER TABLE "ItemOrder" ADD CONSTRAINT "ItemOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIcon" ADD CONSTRAINT "UserIcon_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

