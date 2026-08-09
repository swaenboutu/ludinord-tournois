import { RowDataPacket, ResultSetHeader } from 'mysql2';

import { pool } from '../db/pool';

// Représente un tournoi tel que stocké en base
export interface Tournament {
  id: number;
  name: string;
  team_size: number; // nb de joueurs par équipe (fixe pour le tournoi)
  status: 'planned' | 'open' | 'closed';
  created_at: Date;
  closed_at: Date | null;
}

// Ligne SQL typée (mysql2 exige que le type étende RowDataPacket)
interface TournamentRow extends RowDataPacket, Tournament {}

// Retourne tous les tournois, du plus récent au plus ancien
export async function listTournaments(): Promise<Tournament[]> {
  const [rows] = await pool.query<TournamentRow[]>(
    'SELECT id, name, team_size, status, created_at, closed_at FROM tournaments ORDER BY created_at DESC',
  );
  return rows;
}

// Récupère un tournoi par son identifiant, ou null s'il n'existe pas
export async function getTournament(id: number): Promise<Tournament | null> {
  const [rows] = await pool.execute<TournamentRow[]>(
    'SELECT id, name, team_size, status, created_at, closed_at FROM tournaments WHERE id = ? LIMIT 1',
    [id],
  );
  return rows[0] ?? null;
}

// Crée un tournoi (avec sa taille d'équipe), à l'état "planifié"
export async function createTournament(name: string, teamSize: number): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    "INSERT INTO tournaments (name, team_size, status) VALUES (?, ?, 'planned')",
    [name, teamSize],
  );
  return result.insertId;
}

// Démarre un tournoi planifié (statut -> en cours)
export async function startTournament(id: number): Promise<void> {
  await pool.execute("UPDATE tournaments SET status = 'open' WHERE id = ?", [id]);
}

// Clôture un tournoi (statut + date de clôture)
export async function closeTournament(id: number): Promise<void> {
  await pool.execute(
    "UPDATE tournaments SET status = 'closed', closed_at = NOW() WHERE id = ?",
    [id],
  );
}

// Ré-ouvre un tournoi clôturé (statut + date de clôture effacée)
export async function reopenTournament(id: number): Promise<void> {
  await pool.execute(
    "UPDATE tournaments SET status = 'open', closed_at = NULL WHERE id = ?",
    [id],
  );
}
