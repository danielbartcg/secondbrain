-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'LIST');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "customFields" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "CustomField" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL DEFAULT 'TEXT',
    "options" JSONB NOT NULL DEFAULT '[]',
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomField_pkey" PRIMARY KEY ("id")
);

