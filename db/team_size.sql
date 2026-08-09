-- =====================================================================
--  Taille d'équipe configurable par tournoi — migration
--  À exécuter sur une base existante (déjà installée avec db/schema.sql
--  d'avant cette évolution). Les nouveaux installs ont déjà la colonne.
--  Les tournois existants passent à 2 joueurs par équipe (comportement
--  historique), modifiable ensuite.
-- =====================================================================

ALTER TABLE tournaments
  ADD COLUMN team_size TINYINT UNSIGNED NOT NULL DEFAULT 2 AFTER name;
