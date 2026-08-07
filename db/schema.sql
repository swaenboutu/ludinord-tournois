-- =====================================================================
--  Gestion de tournois de jeux de société — Schéma MySQL (install neuf)
--  MySQL 8+ / InnoDB / utf8mb4
--  Multi-tournoi : chaque tournoi possède ses jeux, équipes, poules...
--  À exécuter sur une base VIDE. L'ordre des CREATE respecte les FK.
--  Phase finale + réglages du tournoi : lots séparés (voir notes en bas).
-- =====================================================================

-- ---------- Tournois ----------
-- Un tournoi peut être clôturé une fois terminé (permet les stats de fin).
CREATE TABLE tournaments (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name       VARCHAR(100) NOT NULL,
    status     ENUM('open','closed') NOT NULL DEFAULT 'open',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at  DATETIME NULL,             -- rempli à la clôture
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Joueurs ----------
-- Pseudo public + contact facultatif visible admin uniquement (filtrage côté app).
-- Rattachement au tournoi via l'équipe (table team_players), pas de colonne dédiée.
CREATE TABLE players (
    id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
    pseudo  VARCHAR(50)  NOT NULL,
    contact VARCHAR(50)  NULL,             -- numéro de contact facultatif (admin only)
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Équipes ----------
-- name facultatif (fallback = concaténation des 2 pseudos, calculé à l'affichage).
-- color = couleur du pion en hexadécimal (#RRGGBB), auto-assignée ou choisie.
CREATE TABLE teams (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_id INT UNSIGNED NOT NULL,
    name          VARCHAR(80) NULL,
    color         VARCHAR(7)  NOT NULL,    -- ex "#3366CC"
    PRIMARY KEY (id),
    CONSTRAINT fk_teams_tournament FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Liaison joueurs <-> équipe ----------
-- Une équipe compte toujours 2 joueurs (contrainte "exactement 2" gérée côté app).
-- Un joueur n'appartient qu'à une seule équipe (UNIQUE sur player_id).
CREATE TABLE team_players (
    team_id   INT UNSIGNED NOT NULL,
    player_id INT UNSIGNED NOT NULL,
    PRIMARY KEY (team_id, player_id),
    UNIQUE KEY uq_team_players_player (player_id),
    CONSTRAINT fk_team_players_team   FOREIGN KEY (team_id)   REFERENCES teams(id)   ON DELETE CASCADE,
    CONSTRAINT fk_team_players_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Catalogue des jeux (propre à chaque tournoi) ----------
CREATE TABLE games (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_id INT UNSIGNED NOT NULL,
    name          VARCHAR(100) NOT NULL,
    duration_min  SMALLINT UNSIGNED NULL,        -- durée indicative en minutes
    min_players   TINYINT UNSIGNED NOT NULL,     -- capacité mini d'une table
    max_players   TINYINT UNSIGNED NOT NULL,     -- capacité maxi d'une table
    is_team_game  BOOLEAN NOT NULL DEFAULT 0,    -- 1 = jeu en équipe, 0 = jeu solo
    rules_url     VARCHAR(255) NULL,
    availability  ENUM('pool','final','both') NOT NULL DEFAULT 'both', -- présence poule / finale
    PRIMARY KEY (id),
    CONSTRAINT fk_games_tournament FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
    CONSTRAINT chk_games_capacity CHECK (min_players >= 1 AND max_players >= min_players)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Poules ----------
CREATE TABLE pools (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_id INT UNSIGNED NOT NULL,
    name          VARCHAR(50) NOT NULL,   -- ex "Poule A"
    PRIMARY KEY (id),
    CONSTRAINT fk_pools_tournament FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Affectation d'une équipe à une poule (1 équipe = 1 poule) ----------
CREATE TABLE pool_teams (
    pool_id INT UNSIGNED NOT NULL,
    team_id INT UNSIGNED NOT NULL,
    PRIMARY KEY (pool_id, team_id),
    UNIQUE KEY uq_pool_teams_team (team_id),  -- une équipe ne peut être que dans une poule
    CONSTRAINT fk_pool_teams_pool FOREIGN KEY (pool_id) REFERENCES pools(id) ON DELETE CASCADE,
    CONSTRAINT fk_pool_teams_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Manches de poule : liste ordonnée des jeux joués par toutes les équipes ----------
CREATE TABLE pool_rounds (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    tournament_id INT UNSIGNED NOT NULL,
    game_id       INT UNSIGNED NOT NULL,
    round_order   SMALLINT UNSIGNED NOT NULL,   -- ordre de passage défini par l'admin
    PRIMARY KEY (id),
    UNIQUE KEY uq_pool_rounds_order (tournament_id, round_order),
    CONSTRAINT fk_pool_rounds_tournament FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
    CONSTRAINT fk_pool_rounds_game       FOREIGN KEY (game_id)       REFERENCES games(id)       ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Parties : une table de jeu (issue du tirage) pour une manche et une poule ----------
CREATE TABLE parties (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    pool_round_id INT UNSIGNED NOT NULL,
    pool_id       INT UNSIGNED NOT NULL,    -- tirage AU SEIN de la poule
    table_number  SMALLINT UNSIGNED NOT NULL,
    status        ENUM('pending','submitted','validated') NOT NULL DEFAULT 'pending',
    PRIMARY KEY (id),
    UNIQUE KEY uq_parties_table (pool_round_id, pool_id, table_number),
    CONSTRAINT fk_parties_round FOREIGN KEY (pool_round_id) REFERENCES pool_rounds(id) ON DELETE CASCADE,
    CONSTRAINT fk_parties_pool  FOREIGN KEY (pool_id)       REFERENCES pools(id)       ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Résultats : un participant = un joueur (jeu solo) OU une équipe (jeu en équipe) ----------
CREATE TABLE party_results (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    party_id    INT UNSIGNED NOT NULL,
    player_id   INT UNSIGNED NULL,        -- rempli si jeu solo
    team_id     INT UNSIGNED NULL,        -- rempli si jeu en équipe
    finish_rank TINYINT UNSIGNED NULL,    -- classement dans la partie (NULL tant que non saisi)
    points      SMALLINT UNSIGNED NULL,   -- barème relatif calculé depuis finish_rank
    PRIMARY KEY (id),
    UNIQUE KEY uq_results_player (party_id, player_id),
    UNIQUE KEY uq_results_team   (party_id, team_id),
    CONSTRAINT fk_results_party  FOREIGN KEY (party_id)  REFERENCES parties(id) ON DELETE CASCADE,
    CONSTRAINT fk_results_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
    CONSTRAINT fk_results_team   FOREIGN KEY (team_id)   REFERENCES teams(id)   ON DELETE CASCADE,
    -- Exactement un des deux participants renseigné (jamais les deux, jamais aucun)
    CONSTRAINT chk_results_participant CHECK (
        (player_id IS NOT NULL AND team_id IS NULL) OR
        (player_id IS NULL AND team_id IS NOT NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
--  Notes / lots à venir
--  - Phase finale (bracket) : tables dédiées (final_matches, etc.) — lot séparé.
--  - Réglages tournoi (nb de qualifiés par poule, etc.) : lot phase finale.
--  - "Exactement 2 joueurs par équipe" : validé côté application.
--  - Contact joueur visible admin uniquement : filtré côté application.
--  - Un joueur est rattaché à un tournoi via son équipe (team_players -> teams).
-- =====================================================================
