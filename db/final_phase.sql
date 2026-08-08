-- =====================================================================
--  Phase finale (bracket à élimination par étapes) — Lot séparé
--  À exécuter APRÈS db/schema.sql, sur la même base.
--  Principe : l'admin choisit une taille de départ (2/4/8/16/32). Les
--  étapes sont générées par division (16 -> 8 -> 4 -> 2). Chaque étape se
--  joue comme une poule (jeux tirés sur des tables, points identiques) ;
--  la moitié des équipes passe à l'étape suivante, l'égalité étant
--  départagée par le classement de poule (seed).
-- =====================================================================

-- ---------- Étapes de la phase finale ----------
CREATE TABLE final_stages (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_id INT UNSIGNED NOT NULL,
    stage_order   SMALLINT UNSIGNED NOT NULL,   -- 1 = première étape jouée
    team_count    SMALLINT UNSIGNED NOT NULL,   -- nb d'équipes entrant dans l'étape (16, 8, ...)
    PRIMARY KEY (id),
    UNIQUE KEY uq_final_stages_order (tournament_id, stage_order),
    CONSTRAINT fk_final_stages_tournament FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Manches d'une étape : jeux joués, ordonnés ----------
CREATE TABLE final_rounds (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    stage_id    INT UNSIGNED NOT NULL,
    game_id     INT UNSIGNED NOT NULL,
    round_order SMALLINT UNSIGNED NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_final_rounds_order (stage_id, round_order),
    CONSTRAINT fk_final_rounds_stage FOREIGN KEY (stage_id) REFERENCES final_stages(id) ON DELETE CASCADE,
    CONSTRAINT fk_final_rounds_game  FOREIGN KEY (game_id)  REFERENCES games(id)        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Équipes qualifiées dans une étape ----------
-- seed = rang de poule de l'équipe (sert au départage à la qualification).
CREATE TABLE final_stage_teams (
    stage_id INT UNSIGNED NOT NULL,
    team_id  INT UNSIGNED NOT NULL,
    seed     SMALLINT UNSIGNED NOT NULL,
    PRIMARY KEY (stage_id, team_id),
    CONSTRAINT fk_fst_stage FOREIGN KEY (stage_id) REFERENCES final_stages(id) ON DELETE CASCADE,
    CONSTRAINT fk_fst_team  FOREIGN KEY (team_id)  REFERENCES teams(id)        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Tables tirées pour une manche d'étape ----------
CREATE TABLE final_parties (
    id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
    final_round_id INT UNSIGNED NOT NULL,
    table_number   SMALLINT UNSIGNED NOT NULL,
    status         ENUM('pending','submitted','validated') NOT NULL DEFAULT 'pending',
    PRIMARY KEY (id),
    UNIQUE KEY uq_final_parties_table (final_round_id, table_number),
    CONSTRAINT fk_fp_round FOREIGN KEY (final_round_id) REFERENCES final_rounds(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Résultats d'une table d'étape ----------
-- Un participant = un joueur (jeu solo) OU une équipe (jeu en équipe).
CREATE TABLE final_party_results (
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
