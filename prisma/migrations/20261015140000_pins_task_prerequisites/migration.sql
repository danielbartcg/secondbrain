-- CreateEnum
CREATE TYPE "PinKind" AS ENUM ('PROJECT', 'MINDMAP');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "prerequisiteIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "Pin" (
    "userId" TEXT NOT NULL,
    "kind" "PinKind" NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pin_pkey" PRIMARY KEY ("userId","kind","targetId")
);

-- AddForeignKey
ALTER TABLE "Pin" ADD CONSTRAINT "Pin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

