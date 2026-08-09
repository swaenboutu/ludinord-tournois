import { RowDataPacket, ResultSetHeader } from 'mysql2';

import { pool } from '../db/pool';
import { listPoolStandings } from './standingsRepository';
import {
  Party,
  PartyParticipant,
  RankInput,
  ScoredResult,
  competitionScores,
  shuffle,
  splitBalanced,
  teamTableCount,
  assignSolo,
} from './partyRepository';

// Une étape de la phase finale (mini-poule à élimination).
export interface FinalStage {
  id: number;
  tournament_id: number;
  stage_order: number;
  team_count: number; // nb d'équipes entrant dans l'étape
  name: string; // libellé dérivé (Finale, Demi-finales, ...)
  round_count: number;
  team_assigned: number; // nb d'équipes réellement qualifiées dans l'étape
}

// Une manche d'étape (un jeu à jouer, à un rang donné).
export interface FinalRound {
  id: number;
  stage_id: number;
  game_id: number;
  round_order: number;
  game_name: string;
  is_team_game: boolean;
  min_players: number;
  max_players: number;
  table_count: number;
}

// Une équipe qualifiée dans une étape (seed = rang de poule).
export interface FinalStageTeam {
  team_id: number;
  seed: number;
  name: string | null;
  color: string;
  pseudos: string | null;
}

// Classement d'une étape (points remis à zéro), avec seed pour le départage.
export interface StageStanding {
  team_id: number;
  seed: number;
  name: string | null;
  color: string;
  pseudos: string | null;
  team_points: number;
  solo_points: number;
  total: number;
}

// Libellé d'étape d'après le nombre d'équipes entrantes.
function stageName(teamCount: number): string {
  switch (teamCount) {
    case 2:
      return 'Finale';
    case 4:
      return 'Demi-finales';
    case 8:
      return 'Quarts de finale';
    case 16:
      return '8emes de finale';
    case 32:
      return '16emes de finale';
    default:
      return `Top ${teamCount}`;
  }
}

// Tailles de départ valides (puissances de 2 de 2 à 32).
export const START_SIZES = [2, 4, 8, 16, 32];

// ---------- Étapes ----------

// Crée la phase finale : génère les étapes par division (16 -> 8 -> 4 -> 2).
// Remplace toute phase finale existante du tournoi.
export async function createFinalPhase(tournamentId: number, startSize: number): Promise<void> {
  if (!START_SIZES.includes(startSize)) {
    return;
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('DELETE FROM final_stages WHERE tournament_id = ?', [tournamentId]);

    let size = startSize;
    let order = 1;
    while (size >= 2) {
      await connection.execute(
        'INSERT INTO final_stages (tournament_id, stage_order, team_count) VALUES (?, ?, ?)',
        [tournamentId, order, size],
      );
      size = Math.floor(size / 2);
      order += 1;
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// Supprime toute la phase finale d'un tournoi.
export async function deleteFinalPhase(tournamentId: number): Promise<void> {
  await pool.execute('DELETE FROM final_stages WHERE tournament_id = ?', [tournamentId]);
}

const SELECT_STAGES = `
  SELECT s.id, s.tournament_id, s.stage_order, s.team_count,
         (SELECT COUNT(*) FROM final_rounds r WHERE r.stage_id = s.id) AS round_count,
         (SELECT COUNT(*) FROM final_stage_teams st WHERE st.stage_id = s.id) AS team_assigned
    FROM final_stages s`;

function mapStage(row: RowDataPacket): FinalStage {
  return {
    id: row.id,
    tournament_id: row.tournament_id,
    stage_order: row.stage_order,
    team_count: row.team_count,
    name: stageName(row.team_count),
    round_count: Number(row.round_count),
    team_assigned: Number(row.team_assigned),
  };
}

// Liste les étapes d'un tournoi, dans l'ordre.
export async function listFinalStages(tournamentId: number): Promise<FinalStage[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `${SELECT_STAGES} WHERE s.tournament_id = ? ORDER BY s.stage_order`,
    [tournamentId],
  );
  return rows.map(mapStage);
}

// Récupère une étape précise d'un tournoi, ou null.
export async function getStage(tournamentId: number, stageId: number): Promise<FinalStage | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `${SELECT_STAGES} WHERE s.id = ? AND s.tournament_id = ? LIMIT 1`,
    [stageId, tournamentId],
  );
  const row = rows[0];
  return row ? mapStage(row) : null;
}

// ---------- Manches d'une étape ----------

const SELECT_FINAL_ROUNDS = `
  SELECT r.id, r.stage_id, r.game_id, r.round_order,
         g.name AS game_name, g.is_team_game, g.min_players, g.max_players,
         (SELECT COUNT(*) FROM final_parties fp WHERE fp.final_round_id = r.id) AS table_count
    FROM final_rounds r
    JOIN games g ON g.id = r.game_id`;

function mapFinalRound(row: RowDataPacket): FinalRound {
  return {
    id: row.id,
    stage_id: row.stage_id,
    game_id: row.game_id,
    round_order: row.round_order,
    game_name: row.game_name,
    is_team_game: row.is_team_game === 1,
    min_players: row.min_players,
    max_players: row.max_players,
    table_count: Number(row.table_count),
  };
}

// Manches d'une étape, dans l'ordre.
export async function listStageRounds(stageId: number): Promise<FinalRound[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `${SELECT_FINAL_ROUNDS} WHERE r.stage_id = ? ORDER BY r.round_order`,
    [stageId],
  );
  return rows.map(mapFinalRound);
}

// Récupère une manche d'étape (bornée au tournoi via l'étape), ou null.
export async function getFinalRound(
  tournamentId: number,
  roundId: number,
): Promise<FinalRound | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `${SELECT_FINAL_ROUNDS}
       JOIN final_stages s ON s.id = r.stage_id
      WHERE r.id = ? AND s.tournament_id = ? LIMIT 1`,
    [roundId, tournamentId],
  );
  const row = rows[0];
  return row ? mapFinalRound(row) : null;
}

// Jeux ajoutables comme manche d'étape (dispo en finale, pas déjà retenus dans l'étape).
export async function listEligibleFinalGames(
  tournamentId: number,
  stageId: number,
): Promise<{ id: number; name: string }[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT g.id, g.name
       FROM games g
      WHERE g.tournament_id = ?
        AND g.availability IN ('final', 'both')
        AND g.id NOT IN (SELECT game_id FROM final_rounds WHERE stage_id = ?)
      ORDER BY g.name`,
    [tournamentId, stageId],
  );
  return rows.map((r) => ({ id: r.id as number, name: r.name as string }));
}

// Ajoute un jeu en fin de manches d'une étape (ignore si invalide/déjà présent).
export async function addStageRound(
  tournamentId: number,
  stageId: number,
  gameId: number,
): Promise<void> {
  const [games] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM games
      WHERE id = ? AND tournament_id = ? AND availability IN ('final', 'both') LIMIT 1`,
    [gameId, tournamentId],
  );
  if (games.length === 0) {
    return;
  }
  const [exists] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM final_rounds WHERE stage_id = ? AND game_id = ? LIMIT 1',
    [stageId, gameId],
  );
  if (exists.length > 0) {
    return;
  }
  const [maxRows] = await pool.execute<RowDataPacket[]>(
    'SELECT COALESCE(MAX(round_order), 0) + 1 AS next FROM final_rounds WHERE stage_id = ?',
    [stageId],
  );
  await pool.execute(
    'INSERT INTO final_rounds (stage_id, game_id, round_order) VALUES (?, ?, ?)',
    [stageId, gameId, Number(maxRows[0].next)],
  );
}

// Retire une manche d'étape (parties tirées en cascade).
export async function removeStageRound(stageId: number, roundId: number): Promise<void> {
  await pool.execute('DELETE FROM final_rounds WHERE id = ? AND stage_id = ?', [roundId, stageId]);
}

// Déplace une manche d'étape (échange de rang avec sa voisine, via un rang temporaire).
export async function moveStageRound(
  stageId: number,
  roundId: number,
  direction: 'up' | 'down',
): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<RowDataPacket[]>(
      'SELECT id, round_order FROM final_rounds WHERE stage_id = ? ORDER BY round_order',
      [stageId],
    );
    const index = rows.findIndex((r) => r.id === roundId);
    if (index === -1) {
      await connection.rollback();
      return;
    }
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= rows.length) {
      await connection.rollback();
      return;
    }
    const current = rows[index];
    const neighbor = rows[swapIndex];
    const [maxRows] = await connection.execute<RowDataPacket[]>(
      'SELECT COALESCE(MAX(round_order), 0) + 1 AS temp FROM final_rounds WHERE stage_id = ?',
      [stageId],
    );
    const temp = Number(maxRows[0].temp);
    await connection.execute('UPDATE final_rounds SET round_order = ? WHERE id = ?', [temp, current.id]);
    await connection.execute('UPDATE final_rounds SET round_order = ? WHERE id = ?', [
      current.round_order,
      neighbor.id,
    ]);
    await connection.execute('UPDATE final_rounds SET round_order = ? WHERE id = ?', [
      neighbor.round_order,
      current.id,
    ]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// ---------- Équipes d'une étape ----------

// Équipes qualifiées dans une étape, par seed croissant (meilleur classement d'abord).
export async function listStageTeams(stageId: number): Promise<FinalStageTeam[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT fst.team_id, fst.seed, t.name, t.color,
            (SELECT GROUP_CONCAT(pp.pseudo ORDER BY pp.id SEPARATOR ' & ')
               FROM team_players tp JOIN players pp ON pp.id = tp.player_id
              WHERE tp.team_id = fst.team_id) AS pseudos
       FROM final_stage_teams fst
       JOIN teams t ON t.id = fst.team_id
      WHERE fst.stage_id = ?
      ORDER BY fst.seed`,
    [stageId],
  );
  return rows.map((r) => ({
    team_id: r.team_id as number,
    seed: r.seed as number,
    name: r.name,
    color: r.color as string,
    pseudos: r.pseudos,
  }));
}

// Qualifie la première étape depuis le classement de poule (top N = team_count).
// Réinitialise les équipes de l'étape et efface ses tables déjà tirées.
export async function qualifyFirstStage(tournamentId: number, stageId: number): Promise<boolean> {
  const stage = await getStage(tournamentId, stageId);
  if (stage === null || stage.stage_order !== 1) {
    return false;
  }
  const standings = await listPoolStandings(tournamentId);
  const qualified = standings.slice(0, stage.team_count);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // On repart d'une ardoise vierge pour l'étape
    await connection.execute(
      `DELETE fp FROM final_parties fp
         JOIN final_rounds r ON r.id = fp.final_round_id
        WHERE r.stage_id = ?`,
      [stageId],
    );
    await connection.execute('DELETE FROM final_stage_teams WHERE stage_id = ?', [stageId]);
    for (let i = 0; i < qualified.length; i += 1) {
      await connection.execute(
        'INSERT INTO final_stage_teams (stage_id, team_id, seed) VALUES (?, ?, ?)',
        [stageId, qualified[i].team_id, i + 1],
      );
    }
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// ---------- Tirage des tables d'une manche d'étape ----------

// (Re)tire les tables d'une manche : répartit les équipes de l'étape.
export async function drawStageRound(tournamentId: number, roundId: number): Promise<number> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [roundRows] = await connection.execute<RowDataPacket[]>(
      `SELECT r.stage_id, g.is_team_game, g.min_players, g.max_players, tr.team_size
         FROM final_rounds r
         JOIN final_stages s ON s.id = r.stage_id
         JOIN games g ON g.id = r.game_id
         JOIN tournaments tr ON tr.id = s.tournament_id
        WHERE r.id = ? AND s.tournament_id = ? LIMIT 1`,
      [roundId, tournamentId],
    );
    if (roundRows.length === 0) {
      await connection.rollback();
      return 0;
    }
    const round = roundRows[0];
    const isTeam = round.is_team_game === 1;
    const stageId = round.stage_id as number;
    const teamSize = Math.max(1, Number(round.team_size));

    await connection.execute('DELETE FROM final_parties WHERE final_round_id = ?', [roundId]);

    let tables: number[][];
    if (isTeam) {
      const [teamRows] = await connection.execute<RowDataPacket[]>(
        'SELECT team_id FROM final_stage_teams WHERE stage_id = ?',
        [stageId],
      );
      const teamIds = teamRows.map((r) => r.team_id as number);
      if (teamIds.length === 0) {
        await connection.commit();
        return 0;
      }
      const maxPer = Math.max(1, Math.floor(round.max_players / teamSize));
      const minPer = Math.max(1, Math.floor(round.min_players / teamSize));
      const shuffled = shuffle(teamIds);
      const sizes = splitBalanced(shuffled.length, teamTableCount(shuffled.length, maxPer, minPer));
      tables = [];
      let cursor = 0;
      for (const size of sizes) {
        tables.push(shuffled.slice(cursor, cursor + size));
        cursor += size;
      }
    } else {
      const [playerRows] = await connection.execute<RowDataPacket[]>(
        `SELECT p.id AS player_id, tp.team_id
           FROM final_stage_teams fst
           JOIN team_players tp ON tp.team_id = fst.team_id
           JOIN players p ON p.id = tp.player_id
          WHERE fst.stage_id = ?`,
        [stageId],
      );
      if (playerRows.length === 0) {
        await connection.commit();
        return 0;
      }
      const byTeam = new Map<number, number[]>();
      for (const row of playerRows) {
        const teamId = row.team_id as number;
        const list = byTeam.get(teamId) ?? [];
        list.push(row.player_id as number);
        byTeam.set(teamId, list);
      }
      const teamGroups = [...byTeam.values()];
      const count = playerRows.length;
      const maxPer = round.max_players;
      const minSeparationTables = teamSize >= 2 ? teamSize : 1;
      let numTables = Math.max(Math.ceil(count / maxPer), minSeparationTables);
      numTables = Math.min(numTables, count);
      const sizes = splitBalanced(count, numTables);
      tables = assignSolo(teamGroups, sizes);
    }

    for (let t = 0; t < tables.length; t += 1) {
      const [partyResult] = await connection.execute<ResultSetHeader>(
        "INSERT INTO final_parties (final_round_id, table_number, status) VALUES (?, ?, 'pending')",
        [roundId, t + 1],
      );
      const partyId = partyResult.insertId;
      for (const unitId of tables[t]) {
        if (isTeam) {
          await connection.execute(
            'INSERT INTO final_party_results (final_party_id, team_id) VALUES (?, ?)',
            [partyId, unitId],
          );
        } else {
          await connection.execute(
            'INSERT INTO final_party_results (final_party_id, player_id) VALUES (?, ?)',
            [partyId, unitId],
          );
        }
      }
    }

    await connection.commit();
    return tables.length;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// Efface les tables tirées d'une manche d'étape (borné au tournoi).
export async function clearStageRound(tournamentId: number, roundId: number): Promise<void> {
  await pool.execute(
    `DELETE fp FROM final_parties fp
       JOIN final_rounds r ON r.id = fp.final_round_id
       JOIN final_stages s ON s.id = r.stage_id
      WHERE fp.final_round_id = ? AND s.tournament_id = ?`,
    [roundId, tournamentId],
  );
}

// Liste les tables d'une manche d'étape avec leurs participants.
export async function listFinalPartiesForRound(
  tournamentId: number,
  roundId: number,
): Promise<Party[]> {
  const [partyRows] = await pool.execute<RowDataPacket[]>(
    `SELECT fp.id, fp.table_number, fp.status
       FROM final_parties fp
       JOIN final_rounds r ON r.id = fp.final_round_id
       JOIN final_stages s ON s.id = r.stage_id
      WHERE fp.final_round_id = ? AND s.tournament_id = ?
      ORDER BY fp.table_number`,
    [roundId, tournamentId],
  );
  if (partyRows.length === 0) {
    return [];
  }
  const partyIds = partyRows.map((r) => r.id as number);

  const [resultRows] = await pool.query<RowDataPacket[]>(
    `SELECT fpr.final_party_id AS party_id, fpr.id AS result_id, fpr.finish_rank, fpr.points,
            fpr.team_id, t.name AS team_name, t.color AS team_color,
            (SELECT GROUP_CONCAT(pp.pseudo ORDER BY pp.id SEPARATOR ' & ')
               FROM team_players tp JOIN players pp ON pp.id = tp.player_id
              WHERE tp.team_id = fpr.team_id) AS team_pseudos,
            fpr.player_id, pl.pseudo AS player_pseudo, plt.color AS player_team_color
       FROM final_party_results fpr
       LEFT JOIN teams t ON t.id = fpr.team_id
       LEFT JOIN players pl ON pl.id = fpr.player_id
       LEFT JOIN team_players ptp ON ptp.player_id = fpr.player_id
       LEFT JOIN teams plt ON plt.id = ptp.team_id
      WHERE fpr.final_party_id IN (?)
      ORDER BY fpr.final_party_id, fpr.finish_rank IS NULL, fpr.finish_rank, fpr.id`,
    [partyIds],
  );

  const byParty = new Map<number, PartyParticipant[]>();
  for (const row of resultRows) {
    const list = byParty.get(row.party_id as number) ?? [];
    list.push({
      result_id: row.result_id as number,
      finish_rank: row.finish_rank,
      points: row.points,
      team_id: row.team_id,
      team_name: row.team_name,
      team_color: row.team_color,
      team_pseudos: row.team_pseudos,
      player_id: row.player_id,
      player_pseudo: row.player_pseudo,
      player_team_color: row.player_team_color,
    });
    byParty.set(row.party_id as number, list);
  }

  return partyRows.map((r) => ({
    id: r.id as number,
    table_number: r.table_number as number,
    status: r.status as string,
    participants: byParty.get(r.id as number) ?? [],
  }));
}

// Enregistre les places d'une table d'étape et calcule les points (même barème que la poule).
// Renvoie les scores calculés, ou null si la table n'appartient pas au tournoi / places incomplètes.
export async function saveFinalPartyResults(
  tournamentId: number,
  partyId: number,
  ranks: RankInput[],
): Promise<ScoredResult[] | null> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT fpr.id
         FROM final_party_results fpr
         JOIN final_parties fp ON fp.id = fpr.final_party_id
         JOIN final_rounds r ON r.id = fp.final_round_id
         JOIN final_stages s ON s.id = r.stage_id
        WHERE fpr.final_party_id = ? AND s.tournament_id = ?`,
      [partyId, tournamentId],
    );
    if (rows.length === 0) {
      await connection.rollback();
      return null;
    }
    const validIds = new Set(rows.map((r) => r.id as number));
    const filtered = ranks.filter((r) => validIds.has(r.resultId));
    const uniqueIds = new Set(filtered.map((r) => r.resultId));
    if (uniqueIds.size !== validIds.size) {
      await connection.rollback();
      return null;
    }
    const scores = competitionScores(filtered);
    for (const scored of scores) {
      await connection.execute(
        'UPDATE final_party_results SET finish_rank = ?, points = ? WHERE id = ?',
        [scored.finishRank, scored.points, scored.resultId],
      );
    }
    await connection.execute("UPDATE final_parties SET status = 'validated' WHERE id = ?", [partyId]);
    await connection.commit();
    return scores;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// ---------- Classement et qualification d'une étape ----------

// Classement d'une étape (points de cette étape uniquement), départage par seed (rang de poule).
export async function getStageStandings(stageId: number): Promise<StageStanding[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT fst.team_id, fst.seed, t.name, t.color,
            (SELECT GROUP_CONCAT(pp.pseudo ORDER BY pp.id SEPARATOR ' & ')
               FROM team_players tp JOIN players pp ON pp.id = tp.player_id
              WHERE tp.team_id = fst.team_id) AS pseudos,
            COALESCE(tg.pts, 0) AS team_points,
            COALESCE(sg.pts, 0) AS solo_points,
            COALESCE(tg.pts, 0) + COALESCE(sg.pts, 0) AS total
       FROM final_stage_teams fst
       JOIN teams t ON t.id = fst.team_id
       LEFT JOIN (
         SELECT fpr.team_id, SUM(fpr.points) AS pts
           FROM final_party_results fpr
           JOIN final_parties fp ON fp.id = fpr.final_party_id
           JOIN final_rounds r ON r.id = fp.final_round_id
          WHERE r.stage_id = ? AND fpr.team_id IS NOT NULL
          GROUP BY fpr.team_id
       ) tg ON tg.team_id = fst.team_id
       LEFT JOIN (
         SELECT tp.team_id, SUM(fpr.points) AS pts
           FROM final_party_results fpr
           JOIN final_parties fp ON fp.id = fpr.final_party_id
           JOIN final_rounds r ON r.id = fp.final_round_id
           JOIN team_players tp ON tp.player_id = fpr.player_id
          WHERE r.stage_id = ? AND fpr.player_id IS NOT NULL
          GROUP BY tp.team_id
       ) sg ON sg.team_id = fst.team_id
      WHERE fst.stage_id = ?
      ORDER BY total DESC, fst.seed ASC`,
    [stageId, stageId, stageId],
  );
  return rows.map((r) => ({
    team_id: r.team_id as number,
    seed: r.seed as number,
    name: r.name,
    color: r.color as string,
    pseudos: r.pseudos,
    team_points: Number(r.team_points),
    solo_points: Number(r.solo_points),
    total: Number(r.total),
  }));
}

// Qualifie la moitié des équipes de l'étape vers l'étape suivante.
// Ordre : points de l'étape décroissants, égalité départagée par le seed (rang de poule).
// Renvoie false s'il n'y a pas d'étape suivante (dernière étape = finale).
export async function advanceStage(tournamentId: number, stageId: number): Promise<boolean> {
  const stage = await getStage(tournamentId, stageId);
  if (stage === null) {
    return false;
  }
  const [nextRows] = await pool.execute<RowDataPacket[]>(
    'SELECT id, team_count FROM final_stages WHERE tournament_id = ? AND stage_order = ? LIMIT 1',
    [tournamentId, stage.stage_order + 1],
  );
  if (nextRows.length === 0) {
    return false;
  }
  const nextStageId = nextRows[0].id as number;
  const nextCount = Number(nextRows[0].team_count);

  const standings = await getStageStandings(stageId);
  const promoted = standings.slice(0, nextCount);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Réinitialise l'étape suivante (équipes + tables déjà tirées)
    await connection.execute(
      `DELETE fp FROM final_parties fp
         JOIN final_rounds r ON r.id = fp.final_round_id
        WHERE r.stage_id = ?`,
      [nextStageId],
    );
    await connection.execute('DELETE FROM final_stage_teams WHERE stage_id = ?', [nextStageId]);
    for (const team of promoted) {
      // On conserve le seed (rang de poule) pour les départages ultérieurs
      await connection.execute(
        'INSERT INTO final_stage_teams (stage_id, team_id, seed) VALUES (?, ?, ?)',
        [nextStageId, team.team_id, team.seed],
      );
    }
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// ---------- Grille de la finale (dernière étape) ----------

// Ligne d'une équipe finaliste : points par jeu (dans l'ordre des manches) + total.
export interface FinaleTeamRow {
  team_id: number;
  name: string | null;
  color: string;
  pseudos: string | null;
  points: number[]; // aligné sur l'ordre de `rounds`
  total: number;
  leading: boolean; // équipe en tête (total maximal, > 0)
}

// Grille de la finale : jeux (manches) et points de chaque finaliste par jeu.
export interface FinaleGrid {
  name: string;
  rounds: { id: number; game_name: string }[];
  teams: FinaleTeamRow[];
}

// Assemble la grille de la finale (dernière étape) : finalistes, jeux, points par jeu.
// Renvoie null si aucune phase finale n'est configurée.
export async function getFinaleGrid(tournamentId: number): Promise<FinaleGrid | null> {
  const [stageRows] = await pool.execute<RowDataPacket[]>(
    'SELECT id, team_count FROM final_stages WHERE tournament_id = ? ORDER BY stage_order DESC LIMIT 1',
    [tournamentId],
  );
  if (stageRows.length === 0) {
    return null;
  }
  const stageId = stageRows[0].id as number;
  const teamCount = Number(stageRows[0].team_count);

  const teams = await listStageTeams(stageId);
  const rounds = await listStageRounds(stageId);

  // Points par (manche, équipe) : jeu en équipe -> résultat de l'équipe ;
  // jeu solo -> somme des points des joueurs de l'équipe.
  const [pointRows] = await pool.execute<RowDataPacket[]>(
    `SELECT fr.id AS round_id, fst.team_id, COALESCE(SUM(fpr.points), 0) AS points
       FROM final_rounds fr
       JOIN final_stage_teams fst ON fst.stage_id = fr.stage_id
       LEFT JOIN final_parties fp ON fp.final_round_id = fr.id
       LEFT JOIN final_party_results fpr ON fpr.final_party_id = fp.id
            AND (fpr.team_id = fst.team_id
                 OR fpr.player_id IN (
                   SELECT tp.player_id FROM team_players tp WHERE tp.team_id = fst.team_id
                 ))
      WHERE fr.stage_id = ?
      GROUP BY fr.id, fst.team_id`,
    [stageId],
  );

  const pointsByKey = new Map<string, number>();
  for (const row of pointRows) {
    pointsByKey.set(`${row.round_id}:${row.team_id}`, Number(row.points));
  }

  const teamRows: FinaleTeamRow[] = teams.map((team) => {
    const points = rounds.map((round) => pointsByKey.get(`${round.id}:${team.team_id}`) ?? 0);
    const total = points.reduce((sum, p) => sum + p, 0);
    return {
      team_id: team.team_id,
      name: team.name,
      color: team.color,
      pseudos: team.pseudos,
      points,
      total,
      leading: false,
    };
  });

  // Équipe(s) en tête : total maximal strictement positif
  const maxTotal = teamRows.reduce((max, t) => Math.max(max, t.total), 0);
  if (maxTotal > 0) {
    for (const team of teamRows) {
      team.leading = team.total === maxTotal;
    }
  }

  return {
    name: stageName(teamCount),
    rounds: rounds.map((r) => ({ id: r.id, game_name: r.game_name })),
    teams: teamRows,
  };
}
