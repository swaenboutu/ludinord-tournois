-- =====================================================================
--  005 — Statut "planifié" pour les tournois
--  Ajoute la valeur 'planned' à l'ENUM status et en fait la valeur par
--  défaut (un tournoi est planifié à sa création). Les tournois existants
--  ('open'/'closed') restent valides. Rejouable (MODIFY idempotent).
-- =====================================================================

ALTER TABLE tournaments
  MODIFY COLUMN status ENUM('planned','open','closed') NOT NULL DEFAULT 'planned';
