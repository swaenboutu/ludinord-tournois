import { RowDataPacket } from 'mysql2';

import { pool } from '../db/pool';
import { listPartiesForRound, Party } from './partyRepository';

// Identité résolue d'un joueur : son équipe, et lui-même si identifié par pseudo.
export interface Identity {
  teamId: number;
  mePlayerId: number | null; // null si identifié par le nom d'équipe
}

export interface BoardPlayer {
  id: number;
  pseudo: string;
  points: number; // points solo (poule + finale)
  isMe: boolean;
}

export interface BoardTeam {
  id: number;
  name: string | null;
  color: string;
  players: BoardPlayer[];
  total: number; // points jeux en équipe + solo des joueurs (poule + finale)
}

export interface CurrentParty {
  game_name: string;
  rules_url: string | null;
  parties: Party[]; // tables où joue l'équipe / le joueur, avec leurs participants
}

// Résout un pseudo OU un nom d'équipe (insensible à la casse) au sein d'un tournoi.
export async function resolveIdentity(
  tournamentId: number,
  query: string,
): Promise<Identity | null> {
  const [players] = await pool.execute<RowDataPacket[]>(
    `SELECT tp.team_id AS team_id, p.id AS player_id
       FROM players p
       JOIN team_players tp ON tp.player_id = p.id
       JOIN teams t ON t.id = tp.team_id
      WHERE t.tournament_id = ? AND LOWER(p.pseudo) = LOWER(?)
      LIMIT 1`,
    [tournamentId, query],
  );
  if (players.length > 0) {
    return { teamId: players[0].team_id as number, mePlayerId: players[0].player_id as number };
  }

  const [teams] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM teams WHERE tournament_id = ? AND LOWER(name) = LOWER(?) LIMIT 1',
    [tournamentId, query],
  );
  if (teams.length > 0) {
    return { teamId: teams[0].id as number, mePlayerId: null };
  }

  return null;
}

// Récupère l'équipe, ses joueurs (avec points solo) et le total, ou null.
export async function getBoardTeam(
  tournamentId: number,
  teamId: number,
  mePlayerId: number | null,
): Promise<BoardTeam | null> {
  const [teamRows] = await pool.execute<RowDataPacket[]>(
    'SELECT id, name, color FROM teams WHERE id = ? AND tournament_id = ? LIMIT 1',
    [teamId, tournamentId],
  );
  if (teamRows.length === 0) {
    return null;
  }

  // Points solo (poule + finale) par joueur de l'équipe
  const [playerRows] = await pool.execute<RowDataPacket[]>(
    `SELECT p.id, p.pseudo,
            COALESCE((SELECT SUM(points) FROM party_results WHERE player_id = p.id), 0)
            + COALESCE((SELECT SUM(points) FROM final_party_results WHERE player_id = p.id), 0) AS points
       FROM players p
       JOIN team_players tp ON tp.player_id = p.id
      WHERE tp.team_id = ?
      ORDER BY p.id`,
    [teamId],
  );
  const players: BoardPlayer[] = playerRows.map((r) => ({
    id: r.id as number,
    pseudo: r.pseudo as string,
    points: Number(r.points),
    isMe: mePlayerId !== null && (r.id as number) === mePlayerId,
  }));

  // Points gagnés en jeux EN ÉQUIPE (poule + finale)
  const [teamPtsRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COALESCE((SELECT SUM(points) FROM party_results WHERE team_id = ?), 0)
          + COALESCE((SELECT SUM(points) FROM final_party_results WHERE team_id = ?), 0) AS pts`,
    [teamId, teamId],
  );
  const teamGamePoints = Number(teamPtsRows[0].pts);
  const total = teamGamePoints + players.reduce((sum, p) => sum + p.points, 0);

  return {
    id: teamRows[0].id as number,
    name: teamRows[0].name,
    color: teamRows[0].color as string,
    players,
    total,
  };
}

// Position d'une équipe dans le tournoi (rang de compétition + nombre d'équipes).
export interface TeamPosition {
  rank: number;
  totalTeams: number;
}

// Classe toutes les équipes par total (poule + finale) et renvoie le rang de l'équipe.
// Rang de compétition : nb d'équipes strictement au-dessus + 1 (ex æquo => même rang).
export async function getTeamPosition(
  tournamentId: number,
  teamId: number,
): Promise<TeamPosition> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT t.id AS team_id, COALESCE(tg.pts, 0) + COALESCE(sg.pts, 0) AS total
       FROM teams t
       LEFT JOIN (
         SELECT team_id, SUM(pts) AS pts FROM (
           SELECT team_id, points AS pts FROM party_results WHERE team_id IS NOT NULL
           UNION ALL
           SELECT team_id, points AS pts FROM final_party_results WHERE team_id IS NOT NULL
         ) team_pts
         GROUP BY team_id
       ) tg ON tg.team_id = t.id
       LEFT JOIN (
         SELECT tp.team_id, SUM(pts) AS pts FROM (
           SELECT player_id, points AS pts FROM party_results WHERE player_id IS NOT NULL
           UNION ALL
           SELECT player_id, points AS pts FROM final_party_results WHERE player_id IS NOT NULL
         ) solo_pts
         JOIN team_players tp ON tp.player_id = solo_pts.player_id
         GROUP BY tp.team_id
       ) sg ON sg.team_id = t.id
      WHERE t.tournament_id = ?`,
    [tournamentId],
  );

  const totals = new Map<number, number>();
  for (const row of rows) {
    totals.set(row.team_id as number, Number(row.total));
  }
  const myTotal = totals.get(teamId) ?? 0;

  let rank = 1;
  for (const total of totals.values()) {
    if (total > myTotal) {
      rank += 1;
    }
  }

  return { rank, totalTeams: rows.length };
}

// Partie/jeu en cours (phase de poule) : première manche tirée mais non entièrement
// validée ; renvoie le jeu, son lien de règles et les tables de l'équipe / du joueur.
export async function getCurrentParty(
  tournamentId: number,
  teamId: number,
  mePlayerId: number | null,
): Promise<CurrentParty | null> {
  const [roundRows] = await pool.execute<RowDataPacket[]>(
    `SELECT r.id, g.name AS game_name, g.rules_url
       FROM pool_rounds r
       JOIN games g ON g.id = r.game_id
      WHERE r.tournament_id = ?
        AND (SELECT COUNT(*) FROM parties pa WHERE pa.pool_round_id = r.id) > 0
        AND (SELECT COUNT(*) FROM parties pa WHERE pa.pool_round_id = r.id AND pa.status <> 'validated') > 0
      ORDER BY r.round_order
      LIMIT 1`,
    [tournamentId],
  );
  if (roundRows.length === 0) {
    return null;
  }
  const round = roundRows[0];

  // Ids des tables où se trouve l'équipe (jeu en équipe) ou le joueur (jeu solo).
  // Identifié par pseudo -> uniquement sa table ; par nom d'équipe -> celles des 2 joueurs.
  let idRows: RowDataPacket[];
  if (mePlayerId !== null) {
    [idRows] = await pool.execute<RowDataPacket[]>(
      `SELECT DISTINCT pa.id
         FROM parties pa
         JOIN party_results pr ON pr.party_id = pa.id
        WHERE pa.pool_round_id = ? AND (pr.team_id = ? OR pr.player_id = ?)`,
      [round.id, teamId, mePlayerId],
    );
  } else {
    [idRows] = await pool.execute<RowDataPacket[]>(
      `SELECT DISTINCT pa.id
         FROM parties pa
         JOIN party_results pr ON pr.party_id = pa.id
        WHERE pa.pool_round_id = ?
          AND (pr.team_id = ? OR pr.player_id IN (SELECT player_id FROM team_players WHERE team_id = ?))`,
      [round.id, teamId, teamId],
    );
  }

  const partyIds = new Set(idRows.map((r) => r.id as number));
  const allParties = await listPartiesForRound(tournamentId, round.id as number);
  const parties = allParties.filter((p) => partyIds.has(p.id));

  return {
    game_name: round.game_name as string,
    rules_url: round.rules_url,
    parties,
  };
}
