-- Profil (prénom, nom, photo, thème), rôle administrateur et hiérarchie (manager).
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

ALTER TABLE "User" ADD COLUMN "firstName" TEXT NOT NULL DEFAULT '',
ADD COLUMN "lastName" TEXT NOT NULL DEFAULT '',
ADD COLUMN "avatarUrl" TEXT,
ADD COLUMN "theme" TEXT NOT NULL DEFAULT 'light',
ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'USER',
ADD COLUMN "managerId" TEXT;

-- Reprise : le nom existant devient le prénom.
UPDATE "User" SET "firstName" = "name";

CREATE INDEX "User_managerId_idx" ON "User"("managerId");
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
