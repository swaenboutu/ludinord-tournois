import { RowDataPacket } from 'mysql2';

import { pool } from '../db/pool';

// Une manche de poule : un jeu à jouer, à un rang donné, commun à tout le tournoi.
// table_count = nombre de tables déjà tirées pour cette manche (0 = pas encore tiré).
export interface PoolRound {
  id: number;
  tournament_id: number;
  game_id: number;
  round_order: number;
  game_name: string;
  is_team_game: boolean;
  min_players: number;
  max_players: number;
  table_count: number;
}

interface PoolRoundRow extends RowDataPacket {
  id: number;
  tournament_id: number;
  game_id: number;
  round_order: number;
  game_name: string;
  is_team_game: number;
  min_players: number;
  max_players: number;
  table_count: number;
}

const SELECT_ROUNDS = `
  SELECT r.id, r.tournament_id, r.game_id, r.round_order,
         g.name AS game_name, g.is_team_game, g.min_players, g.max_players,
         (SELECT COUNT(*) FROM parties pa WHERE pa.pool_round_id = r.id) AS table_count
    FROM pool_rounds r
    JOIN games g ON g.id = r.game_id`;

// Convertit une ligne SQL en objet de domaine (0/1 -> booléen)
function mapRound(row: PoolRoundRow): PoolRound {
  return {
    id: row.id,
    tournament_id: row.tournament_id,
    game_id: row.game_id,
    round_order: row.round_order,
    game_name: row.game_name,
    is_team_game: row.is_team_game === 1,
    min_players: row.min_players,
    max_players: row.max_players,
    table_count: Number(row.table_count),
  };
}

// Liste les manches d'un tournoi, dans l'ordre de passage
export async function listPoolRounds(tournamentId: number): Promise<PoolRound[]> {
  const [rows] = await pool.execute<PoolRoundRow[]>(
    `${SELECT_ROUNDS} WHERE r.tournament_id = ? ORDER BY r.round_order`,
    [tournamentId],
  );
  return rows.map(mapRound);
}

// Récupère une manche précise d'un tournoi, ou null
export async function getPoolRound(
  tournamentId: number,
  roundId: number,
): Promise<PoolRound | null> {
  const [rows] = await pool.execute<PoolRoundRow[]>(
    `${SELECT_ROUNDS} WHERE r.id = ? AND r.tournament_id = ? LIMIT 1`,
    [roundId, tournamentId],
  );
  const row = rows[0];
  return row ? mapRound(row) : null;
}

// Jeux qu'on peut encore ajouter comme manche (présents en poule, pas déjà retenus)
export async function listEligibleGames(
  tournamentId: number,
): Promise<{ id: number; name: string }[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT g.id, g.name
       FROM games g
      WHERE g.tournament_id = ?
        AND g.availability IN ('pool', 'both')
        AND g.id NOT IN (SELECT game_id FROM pool_rounds WHERE tournament_id = ?)
      ORDER BY g.name`,
    [tournamentId, tournamentId],
  );
  return rows.map((r) => ({ id: r.id as number, name: r.name as string }));
}

// Ajoute un jeu en fin de liste des manches (ignore si jeu invalide ou déjà présent)
export async function addPoolRound(tournamentId: number, gameId: number): Promise<void> {
  const [games] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM games
      WHERE id = ? AND tournament_id = ? AND availability IN ('pool', 'both') LIMIT 1`,
    [gameId, tournamentId],
  );
  if (games.length === 0) {
    return;
  }

  const [exists] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM pool_rounds WHERE tournament_id = ? AND game_id = ? LIMIT 1',
    [tournamentId, gameId],
  );
  if (exists.length > 0) {
    return;
  }

  const [maxRows] = await pool.execute<RowDataPacket[]>(
    'SELECT COALESCE(MAX(round_order), 0) + 1 AS next FROM pool_rounds WHERE tournament_id = ?',
    [tournamentId],
  );
  const next = Number(maxRows[0].next);

  await pool.execute(
    'INSERT INTO pool_rounds (tournament_id, game_id, round_order) VALUES (?, ?, ?)',
    [tournamentId, gameId, next],
  );
}

// Retire une manche (les parties tirées tombent en cascade)
export async function removePoolRound(tournamentId: number, roundId: number): Promise<void> {
  await pool.execute('DELETE FROM pool_rounds WHERE id = ? AND tournament_id = ?', [
    roundId,
    tournamentId,
  ]);
}

// Déplace une manche vers le haut/bas en échangeant son rang avec sa voisine.
// L'échange passe par un rang temporaire libre pour respecter l'unicité (tournament_id, round_order).
export async function movePoolRound(
  tournamentId: number,
  roundId: number,
  direction: 'up' | 'down',
): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute<RowDataPacket[]>(
      'SELECT id, round_order FROM pool_rounds WHERE tournament_id = ? ORDER BY round_order',
      [tournamentId],
    );
    const index = rows.findIndex((r) => r.id === roundId);
    if (index === -1) {
      await connection.rollback();
      return;
    }

    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= rows.length) {
      // Déjà en tête ou en queue : rien à faire
      await connection.rollback();
      return;
    }

    const current = rows[index];
    const neighbor = rows[swapIndex];

    const [maxRows] = await connection.execute<RowDataPacket[]>(
      'SELECT COALESCE(MAX(round_order), 0) + 1 AS temp FROM pool_rounds WHERE tournament_id = ?',
      [tournamentId],
    );
    const temp = Number(maxRows[0].temp);

    await connection.execute('UPDATE pool_rounds SET round_order = ? WHERE id = ?', [
      temp,
      current.id,
    ]);
    await connection.execute('UPDATE pool_rounds SET round_order = ? WHERE id = ?', [
      current.round_order,
      neighbor.id,
    ]);
    await connection.execute('UPDATE pool_rounds SET round_order = ? WHERE id = ?', [
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
