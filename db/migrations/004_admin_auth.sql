-- =====================================================================
--  004 — Authentification admin
--  Table clé/valeur pour les réglages applicatifs. On y stocke le HACHÉ
--  du mot de passe admin (jamais le mot de passe en clair) sous la clé
--  'admin_password_hash'. Idempotent (CREATE TABLE IF NOT EXISTS).
-- =====================================================================

CREATE TABLE IF NOT EXISTS app_settings (
    name       VARCHAR(64)  NOT NULL,
    value      VARCHAR(255) NOT NULL,
    updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
