import { RowDataPacket, ResultSetHeader } from 'mysql2';

import { pool } from '../db/pool';

// Présence d'un jeu dans le tournoi
export type GameAvailability = 'pool' | 'final' | 'both';

// Représente un jeu du catalogue d'un tournoi
export interface Game {
  id: number;
  tournament_id: number;
  name: string;
  duration_min: number | null;
  min_players: number;
  max_players: number;
  is_team_game: boolean;
  rules_url: string | null;
  availability: GameAvailability;
}

// Données nécessaires pour créer ou modifier un jeu
export interface GameInput {
  name: string;
  duration_min: number | null;
  min_players: number;
  max_players: number;
  is_team_game: boolean;
  rules_url: string | null;
  availability: GameAvailability;
}

// Ligne SQL brute (is_team_game arrive en 0/1 côté MySQL)
interface GameRow extends RowDataPacket {
  id: number;
  tournament_id: number;
  name: string;
  duration_min: number | null;
  min_players: number;
  max_players: number;
  is_team_game: number;
  rules_url: string | null;
  availability: GameAvailability;
}

// Convertit une ligne SQL en objet de domaine (0/1 -> booléen)
function mapGame(row: GameRow): Game {
  return {
    id: row.id,
    tournament_id: row.tournament_id,
    name: row.name,
    duration_min: row.duration_min,
    min_players: row.min_players,
    max_players: row.max_players,
    is_team_game: row.is_team_game === 1,
    rules_url: row.rules_url,
    availability: row.availability,
  };
}

const SELECT_COLUMNS =
  'id, tournament_id, name, duration_min, min_players, max_players, is_team_game, rules_url, availability';

// Liste les jeux d'un tournoi, triés par nom
export async function listGames(tournamentId: number): Promise<Game[]> {
  const [rows] = await pool.execute<GameRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM games WHERE tournament_id = ? ORDER BY name`,
    [tournamentId],
  );
  return rows.map(mapGame);
}

// Récupère un jeu précis d'un tournoi, ou null s'il n'existe pas
export async function getGame(tournamentId: number, gameId: number): Promise<Game | null> {
  const [rows] = await pool.execute<GameRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM games WHERE id = ? AND tournament_id = ? LIMIT 1`,
    [gameId, tournamentId],
  );
  const row = rows[0];
  return row ? mapGame(row) : null;
}

// Crée un jeu dans un tournoi et retourne son identifiant
export async function createGame(tournamentId: number, input: GameInput): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO games (tournament_id, name, duration_min, min_players, max_players, is_team_game, rules_url, availability)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tournamentId,
      input.name,
      input.duration_min,
      input.min_players,
      input.max_players,
      input.is_team_game ? 1 : 0,
      input.rules_url,
      input.availability,
    ],
  );
  return result.insertId;
}

// Met à jour un jeu (borné au tournoi pour éviter tout accès croisé)
export async function updateGame(
  tournamentId: number,
  gameId: number,
  input: GameInput,
): Promise<void> {
  await pool.execute(
    `UPDATE games
        SET name = ?, duration_min = ?, min_players = ?, max_players = ?,
            is_team_game = ?, rules_url = ?, availability = ?
      WHERE id = ? AND tournament_id = ?`,
    [
      input.name,
      input.duration_min,
      input.min_players,
      input.max_players,
      input.is_team_game ? 1 : 0,
      input.rules_url,
      input.availability,
      gameId,
      tournamentId,
    ],
  );
}

// Supprime un jeu d'un tournoi
export async function deleteGame(tournamentId: number, gameId: number): Promise<void> {
  await pool.execute('DELETE FROM games WHERE id = ? AND tournament_id = ?', [gameId, tournamentId]);
}

// Vide la liste : supprime tous les jeux du tournoi.
export async function deleteAllGames(tournamentId: number): Promise<void> {
  await pool.execute('DELETE FROM games WHERE tournament_id = ?', [tournamentId]);
}

// Crée plusieurs jeux en une seule transaction (tout ou rien). Renvoie le nombre créé.
export async function createGames(tournamentId: number, inputs: GameInput[]): Promise<number> {
  if (inputs.length === 0) {
    return 0;
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const input of inputs) {
      await connection.execute(
        `INSERT INTO games (tournament_id, name, duration_min, min_players, max_players, is_team_game, rules_url, availability)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tournamentId,
          input.name,
          input.duration_min,
          input.min_players,
          input.max_players,
          input.is_team_game ? 1 : 0,
          input.rules_url,
          input.availability,
        ],
      );
    }
    await connection.commit();
    return inputs.length;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
