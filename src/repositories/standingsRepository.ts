import { RowDataPacket } from 'mysql2';

import { pool } from '../db/pool';

// Classement d'une équipe dans la poule.
// total = points des jeux EN ÉQUIPE (attribués à l'équipe)
//       + somme des points de ses 2 joueurs dans les jeux SOLO.
export interface TeamStanding {
  team_id: number;
  name: string | null;
  color: string;
  pseudos: string | null; // pseudos concaténés (fallback d'affichage si pas de nom)
  team_points: number;
  solo_points: number;
  total: number;
}

// Classement de la poule d'un tournoi, du meilleur total au moins bon.
// Les points non saisis (NULL) ne comptent pas (SUM les ignore).
export async function listPoolStandings(tournamentId: number): Promise<TeamStanding[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT t.id AS team_id, t.name, t.color,
            (SELECT GROUP_CONCAT(pp.pseudo ORDER BY pp.id SEPARATOR ' & ')
               FROM team_players tp JOIN players pp ON pp.id = tp.player_id
              WHERE tp.team_id = t.id) AS pseudos,
            COALESCE(tg.pts, 0) AS team_points,
            COALESCE(sg.pts, 0) AS solo_points,
            COALESCE(tg.pts, 0) + COALESCE(sg.pts, 0) AS total
       FROM teams t
       LEFT JOIN (
         SELECT team_id, SUM(points) AS pts
           FROM party_results
          WHERE team_id IS NOT NULL
          GROUP BY team_id
       ) tg ON tg.team_id = t.id
       LEFT JOIN (
         SELECT tp.team_id, SUM(pr.points) AS pts
           FROM party_results pr
           JOIN team_players tp ON tp.player_id = pr.player_id
          WHERE pr.player_id IS NOT NULL
          GROUP BY tp.team_id
       ) sg ON sg.team_id = t.id
      WHERE t.tournament_id = ?
      ORDER BY total DESC, t.name IS NULL, t.name, t.id`,
    [tournamentId],
  );

  return rows.map((r) => ({
    team_id: r.team_id as number,
    name: r.name,
    color: r.color as string,
    pseudos: r.pseudos,
    team_points: Number(r.team_points),
    solo_points: Number(r.solo_points),
    total: Number(r.total),
  }));
}

// Points solo cumulés d'un joueur de l'équipe
export interface PlayerSolo {
  pseudo: string;
  points: number;
}

// Détail des points d'une équipe : jeux en équipe + solo par joueur
export interface TeamStandingDetail {
  team_points: number;
  solo_points: number;
  total: number;
  players: PlayerSolo[];
}

// Détail des points d'une équipe (null si l'équipe n'appartient pas au tournoi)
export async function getTeamStanding(
  tournamentId: number,
  teamId: number,
): Promise<TeamStandingDetail | null> {
  const [teamRows] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM teams WHERE id = ? AND tournament_id = ? LIMIT 1',
    [teamId, tournamentId],
  );
  if (teamRows.length === 0) {
    return null;
  }

  // Points gagnés en jeux EN ÉQUIPE (résultats portés par l'équipe)
  const [teamPtsRows] = await pool.execute<RowDataPacket[]>(
    'SELECT COALESCE(SUM(points), 0) AS pts FROM party_results WHERE team_id = ?',
    [teamId],
  );
  const teamPoints = Number(teamPtsRows[0].pts);

  // Points SOLO cumulés par joueur de l'équipe
  const [playerRows] = await pool.execute<RowDataPacket[]>(
    `SELECT p.pseudo, COALESCE(SUM(pr.points), 0) AS pts
       FROM players p
       JOIN team_players tp ON tp.player_id = p.id
       LEFT JOIN party_results pr ON pr.player_id = p.id
      WHERE tp.team_id = ?
      GROUP BY p.id, p.pseudo
      ORDER BY p.id`,
    [teamId],
  );
  const players = playerRows.map((r) => ({
    pseudo: r.pseudo as string,
    points: Number(r.pts),
  }));
  const soloPoints = players.reduce((sum, p) => sum + p.points, 0);

  return {
    team_points: teamPoints,
    solo_points: soloPoints,
    total: teamPoints + soloPoints,
    players,
  };
}
