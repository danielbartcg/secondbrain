-- CreateEnum
CREATE TYPE "RiskStrategy" AS ENUM ('ACCEPT', 'MITIGATE', 'TRANSFER', 'ELIMINATE');

-- AlterTable
ALTER TABLE "Risk" DROP COLUMN "dueDate",
ADD COLUMN     "strategy" "RiskStrategy";

