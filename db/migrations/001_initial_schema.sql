-- =====================================================================
--  001 — Schéma initial (multi-tournoi : jeux, équipes, poules, résultats)
--  MySQL 8+ / InnoDB / utf8mb4. Idempotent (CREATE TABLE IF NOT EXISTS).
--  L'ordre des CREATE respecte les clés étrangères.
-- =====================================================================

CREATE TABLE IF NOT EXISTS tournaments (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name       VARCHAR(100) NOT NULL,
    status     ENUM('open','closed') NOT NULL DEFAULT 'open',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at  DATETIME NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pseudo public + contact facultatif (admin only). Rattachement au tournoi via l'équipe.
CREATE TABLE IF NOT EXISTS players (
    id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
    pseudo  VARCHAR(50)  NOT NULL,
    contact VARCHAR(50)  NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- name facultatif (fallback = pseudos concaténés) ; color = pion #RRGGBB.
CREATE TABLE IF NOT EXISTS teams (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_id INT UNSIGNED NOT NULL,
    name          VARCHAR(80) NULL,
    color         VARCHAR(7)  NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT fk_teams_tournament FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Un joueur n'appartient qu'à une seule équipe (UNIQUE sur player_id).
CREATE TABLE IF NOT EXISTS team_players (
    team_id   INT UNSIGNED NOT NULL,
    player_id INT UNSIGNED NOT NULL,
    PRIMARY KEY (team_id, player_id),
    UNIQUE KEY uq_team_players_player (player_id),
    CONSTRAINT fk_team_players_team   FOREIGN KEY (team_id)   REFERENCES teams(id)   ON DELETE CASCADE,
    CONSTRAINT fk_team_players_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Catalogue des jeux propre à chaque tournoi.
CREATE TABLE IF NOT EXISTS games (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_id INT UNSIGNED NOT NULL,
    name          VARCHAR(100) NOT NULL,
    duration_min  SMALLINT UNSIGNED NULL,
    min_players   TINYINT UNSIGNED NOT NULL,
    max_players   TINYINT UNSIGNED NOT NULL,
    is_team_game  BOOLEAN NOT NULL DEFAULT 0,
    rules_url     VARCHAR(255) NULL,
    availability  ENUM('pool','final','both') NOT NULL DEFAULT 'both',
    PRIMARY KEY (id),
    CONSTRAINT fk_games_tournament FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
    CONSTRAINT chk_games_capacity CHECK (min_players >= 1 AND max_players >= min_players)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pools (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_id INT UNSIGNED NOT NULL,
    name          VARCHAR(50) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT fk_pools_tournament FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Une équipe ne peut être que dans une poule (UNIQUE sur team_id).
CREATE TABLE IF NOT EXISTS pool_teams (
    pool_id INT UNSIGNED NOT NULL,
    team_id INT UNSIGNED NOT NULL,
    PRIMARY KEY (pool_id, team_id),
    UNIQUE KEY uq_pool_teams_team (team_id),
    CONSTRAINT fk_pool_teams_pool FOREIGN KEY (pool_id) REFERENCES pools(id) ON DELETE CASCADE,
    CONSTRAINT fk_pool_teams_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Manches de poule : liste ordonnée des jeux joués par toutes les équipes.
CREATE TABLE IF NOT EXISTS pool_rounds (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_id INT UNSIGNED NOT NULL,
    game_id       INT UNSIGNED NOT NULL,
    round_order   SMALLINT UNSIGNED NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pool_rounds_order (tournament_id, round_order),
    CONSTRAINT fk_pool_rounds_tournament FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
    CONSTRAINT fk_pool_rounds_game       FOREIGN KEY (game_id)       REFERENCES games(id)       ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Parties : une table de jeu (issue du tirage) pour une manche et une poule.
CREATE TABLE IF NOT EXISTS parties (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    pool_round_id INT UNSIGNED NOT NULL,
    pool_id       INT UNSIGNED NOT NULL,
    table_number  SMALLINT UNSIGNED NOT NULL,
    status        ENUM('pending','submitted','validated') NOT NULL DEFAULT 'pending',
    PRIMARY KEY (id),
    UNIQUE KEY uq_parties_table (pool_round_id, pool_id, table_number),
    CONSTRAINT fk_parties_round FOREIGN KEY (pool_round_id) REFERENCES pool_rounds(id) ON DELETE CASCADE,
    CONSTRAINT fk_parties_pool  FOREIGN KEY (pool_id)       REFERENCES pools(id)       ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Résultats : un participant = un joueur (solo) OU une équipe (jeu en équipe).
CREATE TABLE IF NOT EXISTS party_results (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    party_id    INT UNSIGNED NOT NULL,
    player_id   INT UNSIGNED NULL,
    team_id     INT UNSIGNED NULL,
    finish_rank TINYINT UNSIGNED NULL,
    points      SMALLINT UNSIGNED NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_results_player (party_id, player_id),
    UNIQUE KEY uq_results_team   (party_id, team_id),
    CONSTRAINT fk_results_party  FOREIGN KEY (party_id)  REFERENCES parties(id) ON DELETE CASCADE,
    CONSTRAINT fk_results_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
    CONSTRAINT fk_results_team   FOREIGN KEY (team_id)   REFERENCES teams(id)   ON DELETE CASCADE,
    CONSTRAINT chk_results_participant CHECK (
        (player_id IS NOT NULL AND team_id IS NULL) OR
        (player_id IS NULL AND team_id IS NOT NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
