-- Tri des valeurs d'un champ personnalisé « liste » : manuel (glisser-déposer) ou forcé A → Z / Z → A.
CREATE TYPE "CustomOptionSort" AS ENUM ('MANUAL', 'ASC', 'DESC');
ALTER TABLE "CustomField" ADD COLUMN "optionSort" "CustomOptionSort" NOT NULL DEFAULT 'MANUAL';
