-- =====================================================================
--  002 — Phase finale (bracket à élimination par étapes)
--  Idempotent (CREATE TABLE IF NOT EXISTS).
-- =====================================================================

CREATE TABLE IF NOT EXISTS final_stages (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_id INT UNSIGNED NOT NULL,
    stage_order   SMALLINT UNSIGNED NOT NULL,
    team_count    SMALLINT UNSIGNED NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_final_stages_order (tournament_id, stage_order),
    CONSTRAINT fk_final_stages_tournament FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS final_rounds (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    stage_id    INT UNSIGNED NOT NULL,
    game_id     INT UNSIGNED NOT NULL,
    round_order SMALLINT UNSIGNED NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_final_rounds_order (stage_id, round_order),
    CONSTRAINT fk_final_rounds_stage FOREIGN KEY (stage_id) REFERENCES final_stages(id) ON DELETE CASCADE,
    CONSTRAINT fk_final_rounds_game  FOREIGN KEY (game_id)  REFERENCES games(id)        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- seed = rang de poule de l'équipe (départage à la qualification).
CREATE TABLE IF NOT EXISTS final_stage_teams (
    stage_id INT UNSIGNED NOT NULL,
    team_id  INT UNSIGNED NOT NULL,
    seed     SMALLINT UNSIGNED NOT NULL,
    PRIMARY KEY (stage_id, team_id),
    CONSTRAINT fk_fst_stage FOREIGN KEY (stage_id) REFERENCES final_stages(id) ON DELETE CASCADE,
    CONSTRAINT fk_fst_team  FOREIGN KEY (team_id)  REFERENCES teams(id)        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS final_parties (
    id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
    final_round_id INT UNSIGNED NOT NULL,
    table_number   SMALLINT UNSIGNED NOT NULL,
    status         ENUM('pending','submitted','validated') NOT NULL DEFAULT 'pending',
    PRIMARY KEY (id),
    UNIQUE KEY uq_final_parties_table (final_round_id, table_number),
    CONSTRAINT fk_fp_round FOREIGN KEY (final_round_id) REFERENCES final_rounds(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS final_party_results (
    id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
    final_party_id INT UNSIGNED NOT NULL,
    player_id      INT UNSIGNED NULL,
    team_id        INT UNSIGNED NULL,
    finish_rank    TINYINT UNSIGNED NULL,
    points         SMALLINT UNSIGNED NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_fpr_player (final_party_id, player_id),
    UNIQUE KEY uq_fpr_team   (final_party_id, team_id),
    CONSTRAINT fk_fpr_party  FOREIGN KEY (final_party_id) REFERENCES final_parties(id) ON DELETE CASCADE,
    CONSTRAINT fk_fpr_player FOREIGN KEY (player_id)      REFERENCES players(id)        ON DELETE CASCADE,
    CONSTRAINT fk_fpr_team   FOREIGN KEY (team_id)        REFERENCES teams(id)          ON DELETE CASCADE,
    CONSTRAINT chk_fpr_participant CHECK (
        (player_id IS NOT NULL AND team_id IS NULL) OR
        (player_id IS NULL AND team_id IS NOT NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
