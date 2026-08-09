-- =====================================================================
--  003 — Taille d'équipe configurable par tournoi (tournaments.team_size)
--  Idempotent : n'ajoute la colonne que si elle n'existe pas déjà (MySQL
--  ne supporte pas ADD COLUMN IF NOT EXISTS -> test via information_schema).
--  Les tournois existants passent à 2 (comportement historique).
-- =====================================================================

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'tournaments'
     AND COLUMN_NAME = 'team_size'
);

SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE tournaments ADD COLUMN team_size TINYINT UNSIGNED NOT NULL DEFAULT 2 AFTER name',
  'DO 0'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
