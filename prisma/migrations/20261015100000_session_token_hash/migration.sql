-- Les jetons de session ne sont plus stockés en clair : la colonne "token"
-- contient désormais l'empreinte SHA-256 (hex) du jeton. Conversion en place
-- des sessions existantes : les clients gardent leur cookie / jeton Bearer,
-- le serveur hache avant de chercher.
UPDATE "Session" SET "token" = encode(sha256(convert_to("token", 'UTF8')), 'hex');
