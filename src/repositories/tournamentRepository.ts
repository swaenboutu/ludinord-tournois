import { RowDataPacket, ResultSetHeader } from 'mysql2';

import { pool } from '../db/pool';

// Représente un tournoi tel que stocké en base
export interface Tournament {
  id: number;
  name: string;
  status: 'open' | 'closed';
  created_at: Date;
  closed_at: Date | null;
}

// Ligne SQL typée (mysql2 exige que le type étende RowDataPacket)
interface TournamentRow extends RowDataPacket, Tournament {}

// Retourne tous les tournois, du plus récent au plus ancien
export async function listTournaments(): Promise<Tournament[]> {
  const [rows] = await pool.query<TournamentRow[]>(
    'SELECT id, name, status, created_at, closed_at FROM tournaments ORDER BY created_at DESC',
  );
  return rows;
}

// Crée un tournoi et retourne son identifiant
export async function createTournament(name: string): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    'INSERT INTO tournaments (name) VALUES (?)',
    [name],
  );
  return result.insertId;
}

// Clôture un tournoi (statut + date de clôture)
export async function closeTournament(id: number): Promise<void> {
  await pool.execute(
    "UPDATE tournaments SET status = 'closed', closed_at = NOW() WHERE id = ?",
    [id],
  );
}
