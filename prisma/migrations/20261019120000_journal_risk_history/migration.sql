-- CreateEnum
CREATE TYPE "JournalBlock" AS ENUM ('SUMMARY', 'POSITIVE', 'NEGATIVE', 'ACHIEVEMENTS', 'REGRETS', 'HABITS', 'IMPROVEMENT');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "journalBlocks" TEXT[] DEFAULT ARRAY['SUMMARY', 'POSITIVE', 'NEGATIVE', 'ACHIEVEMENTS', 'REGRETS', 'HABITS', 'IMPROVEMENT', 'ACTIVITY']::TEXT[];

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "block" "JournalBlock" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskSnapshot" (
    "id" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JournalEntry_userId_block_day_idx" ON "JournalEntry"("userId", "block", "day");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_userId_day_block_key" ON "JournalEntry"("userId", "day", "block");

-- CreateIndex
CREATE INDEX "RiskSnapshot_projectId_createdAt_idx" ON "RiskSnapshot"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskSnapshot" ADD CONSTRAINT "RiskSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Historique des risques (voyage dans le temps) : instantané à chaque écriture.
-- Horodatage en UTC explicite : les colonnes TIMESTAMP(3) de Prisma sont en UTC,
-- quel que soit le fuseau de la session PostgreSQL.
-- À la suppression en cascade d'un projet, rien n'est enregistré (projet disparu).
CREATE OR REPLACE FUNCTION sb_risk_snapshot() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "Project" WHERE "id" = OLD."projectId") THEN
      INSERT INTO "RiskSnapshot" ("id", "riskId", "projectId", "deleted", "data", "createdAt")
      VALUES (gen_random_uuid()::text, OLD."id", OLD."projectId", true, to_jsonb(OLD), (now() AT TIME ZONE 'UTC'));
    END IF;
    RETURN OLD;
  END IF;
  INSERT INTO "RiskSnapshot" ("id", "riskId", "projectId", "deleted", "data", "createdAt")
  VALUES (gen_random_uuid()::text, NEW."id", NEW."projectId", false, to_jsonb(NEW), (now() AT TIME ZONE 'UTC'));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sb_risk_snapshot AFTER INSERT OR UPDATE OR DELETE ON "Risk"
  FOR EACH ROW EXECUTE FUNCTION sb_risk_snapshot();

-- Risques existants : état actuel daté de leur création (historique antérieur inconnu).
INSERT INTO "RiskSnapshot" ("id", "riskId", "projectId", "deleted", "data", "createdAt")
SELECT gen_random_uuid()::text, r."id", r."projectId", false, to_jsonb(r), r."createdAt" FROM "Risk" r;
