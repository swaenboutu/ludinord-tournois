import { RowDataPacket, ResultSetHeader } from 'mysql2';

import { pool } from '../db/pool';

// Un joueur, tel que rattaché à une équipe
export interface Player {
  id: number;
  pseudo: string;
  contact: string | null;
}

// Une équipe et ses joueurs (rattachement au tournoi via l'équipe)
export interface Team {
  id: number;
  tournament_id: number;
  name: string | null;
  color: string;
  players: Player[]; // tournaments.team_size joueurs (contrainte gérée côté app)
  total_points: number; // points jeux en équipe + points solo des joueurs
}

// Données d'un joueur saisies dans le formulaire
export interface PlayerInput {
  pseudo: string;
  contact: string | null;
}

// Données d'une équipe : nom facultatif, couleur du pion, joueurs (taille = team_size)
export interface TeamInput {
  name: string | null;
  color: string;
  players: PlayerInput[];
}

// Palette par défaut : couleurs distinctes assignées aux pions dans l'ordre
const COLOR_PALETTE = [
  '#3366CC', '#DC3912', '#FF9900', '#109618', '#990099',
  '#0099C6', '#DD4477', '#66AA00', '#B82E2E', '#316395',
  '#994499', '#22AA99', '#AAAA11', '#6633CC', '#E67300',
  '#8B0707',
];

// Convertit une couleur HSL en hex #RRGGBB (majuscules), pour générer des teintes
// au-delà de la palette. s et l en pourcentage (0–100), h en degrés (0–360).
function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const a = sn * Math.min(ln, 1 - ln);
  const channel = (n: number): string => {
    const k = (n + h / 30) % 12;
    const value = ln - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * value)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`.toUpperCase();
}

// Couleur aléatoire mais lisible (saturée, ni trop claire ni trop sombre).
function randomReadableColor(): string {
  const hue = Math.floor(Math.random() * 360);
  const saturation = 55 + Math.floor(Math.random() * 25); // 55–79 %
  const lightness = 42 + Math.floor(Math.random() * 16); // 42–57 %
  return hslToHex(hue, saturation, lightness);
}

// Choisit une couleur NON déjà présente dans `used` (qu'on met à jour) :
// d'abord une couleur libre de la palette, sinon une couleur générée unique.
// Garantit l'absence de doublon quel que soit le nombre d'équipes.
export function pickUniqueColor(used: Set<string>): string {
  const free = COLOR_PALETTE.find((c) => !used.has(c));
  if (free) {
    used.add(free);
    return free;
  }
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const color = randomReadableColor();
    if (!used.has(color)) {
      used.add(color);
      return color;
    }
  }
  // Filet ultime (quasi impossible) : balayage de teintes à la recherche d'une libre
  for (let hue = 0; hue < 360; hue += 1) {
    const color = hslToHex(hue, 65, 50);
    if (!used.has(color)) {
      used.add(color);
      return color;
    }
  }
  return randomReadableColor();
}

// Ligne SQL brute d'une équipe jointe à ses joueurs (joueurs à plat)
interface TeamPlayerRow extends RowDataPacket {
  id: number;
  tournament_id: number;
  name: string | null;
  color: string;
  player_id: number | null;
  pseudo: string | null;
  contact: string | null;
  total_points: number;
}

// total_points = points des jeux en équipe (portés par l'équipe)
//              + points solo cumulés de ses joueurs
const SELECT_TEAMS =
  `SELECT t.id, t.tournament_id, t.name, t.color,
          p.id AS player_id, p.pseudo, p.contact,
          COALESCE((SELECT SUM(points) FROM party_results WHERE team_id = t.id), 0)
          + COALESCE((SELECT SUM(pr.points)
                        FROM party_results pr
                        JOIN team_players tp2 ON tp2.player_id = pr.player_id
                       WHERE tp2.team_id = t.id), 0) AS total_points
     FROM teams t
     LEFT JOIN team_players tp ON tp.team_id = t.id
     LEFT JOIN players p       ON p.id = tp.player_id`;

// Regroupe les lignes à plat (une par joueur) en équipes portant leurs joueurs
function groupTeams(rows: TeamPlayerRow[]): Team[] {
  const teams = new Map<number, Team>();
  for (const row of rows) {
    let team = teams.get(row.id);
    if (team === undefined) {
      team = {
        id: row.id,
        tournament_id: row.tournament_id,
        name: row.name,
        color: row.color,
        players: [],
        total_points: Number(row.total_points),
      };
      teams.set(row.id, team);
    }
    if (row.player_id !== null) {
      team.players.push({ id: row.player_id, pseudo: row.pseudo ?? '', contact: row.contact });
    }
  }
  return [...teams.values()];
}

// Liste les équipes d'un tournoi avec leurs joueurs, triées par nom puis id
export async function listTeams(tournamentId: number): Promise<Team[]> {
  const [rows] = await pool.execute<TeamPlayerRow[]>(
    `${SELECT_TEAMS} WHERE t.tournament_id = ?
      ORDER BY total_points DESC, t.name IS NULL, t.name, t.id, p.id`,
    [tournamentId],
  );
  return groupTeams(rows);
}

// Récupère une équipe précise d'un tournoi avec ses joueurs, ou null
export async function getTeam(tournamentId: number, teamId: number): Promise<Team | null> {
  const [rows] = await pool.execute<TeamPlayerRow[]>(
    `${SELECT_TEAMS} WHERE t.id = ? AND t.tournament_id = ? ORDER BY p.id`,
    [teamId, tournamentId],
  );
  const teams = groupTeams(rows);
  return teams[0] ?? null;
}

// Propose une couleur libre dans la palette (à défaut, la première)
export async function suggestColor(tournamentId: number): Promise<string> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT color FROM teams WHERE tournament_id = ?',
    [tournamentId],
  );
  const used = new Set(rows.map((r) => String(r.color).toUpperCase()));
  return pickUniqueColor(used);
}

// Crée une équipe et ses 2 joueurs dans une transaction ; retourne l'id de l'équipe
export async function createTeam(tournamentId: number, input: TeamInput): Promise<number> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [teamResult] = await connection.execute<ResultSetHeader>(
      'INSERT INTO teams (tournament_id, name, color) VALUES (?, ?, ?)',
      [tournamentId, input.name, input.color],
    );
    const teamId = teamResult.insertId;

    for (const player of input.players) {
      const [playerResult] = await connection.execute<ResultSetHeader>(
        'INSERT INTO players (pseudo, contact) VALUES (?, ?)',
        [player.pseudo, player.contact],
      );
      await connection.execute('INSERT INTO team_players (team_id, player_id) VALUES (?, ?)', [
        teamId,
        playerResult.insertId,
      ]);
    }

    await connection.commit();
    return teamId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// Équipe à créer en lot : couleur facultative (null => auto-attribuée).
export interface BulkTeamInput {
  name: string | null;
  color: string | null;
  players: PlayerInput[];
}

// Crée plusieurs équipes (et leurs joueurs) en une seule transaction.
// Les couleurs vides sont auto-attribuées depuis la palette, en évitant les doublons.
// Tout échoue ou tout réussit. Renvoie le nombre d'équipes créées.
export async function createTeams(
  tournamentId: number,
  inputs: BulkTeamInput[],
): Promise<number> {
  if (inputs.length === 0) {
    return 0;
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Couleurs déjà prises dans le tournoi (pour l'auto-attribution)
    const [colorRows] = await connection.execute<RowDataPacket[]>(
      'SELECT color FROM teams WHERE tournament_id = ?',
      [tournamentId],
    );
    const used = new Set(colorRows.map((r) => String(r.color).toUpperCase()));

    for (const input of inputs) {
      let color: string;
      if (input.color) {
        color = input.color;
        used.add(color.toUpperCase());
      } else {
        color = pickUniqueColor(used);
      }

      const [teamResult] = await connection.execute<ResultSetHeader>(
        'INSERT INTO teams (tournament_id, name, color) VALUES (?, ?, ?)',
        [tournamentId, input.name, color],
      );
      const teamId = teamResult.insertId;

      for (const player of input.players) {
        const [playerResult] = await connection.execute<ResultSetHeader>(
          'INSERT INTO players (pseudo, contact) VALUES (?, ?)',
          [player.pseudo, player.contact],
        );
        await connection.execute('INSERT INTO team_players (team_id, player_id) VALUES (?, ?)', [
          teamId,
          playerResult.insertId,
        ]);
      }
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

// Met à jour une équipe et ses joueurs (mise en correspondance par position)
export async function updateTeam(
  tournamentId: number,
  teamId: number,
  input: TeamInput,
): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [teamRows] = await connection.execute<RowDataPacket[]>(
      'SELECT id FROM teams WHERE id = ? AND tournament_id = ? LIMIT 1',
      [teamId, tournamentId],
    );
    if (teamRows.length === 0) {
      // L'équipe n'appartient pas au tournoi : rien à faire
      await connection.rollback();
      return;
    }

    await connection.execute('UPDATE teams SET name = ?, color = ? WHERE id = ?', [
      input.name,
      input.color,
      teamId,
    ]);

    // Ids des joueurs de l'équipe, ordonnés comme à l'affichage
    const [playerRows] = await connection.execute<RowDataPacket[]>(
      'SELECT player_id FROM team_players WHERE team_id = ? ORDER BY player_id',
      [teamId],
    );

    // Mise à jour par position (on ignore tout id fourni par le client)
    for (let index = 0; index < playerRows.length; index += 1) {
      const player = input.players[index];
      if (player !== undefined) {
        await connection.execute('UPDATE players SET pseudo = ?, contact = ? WHERE id = ?', [
          player.pseudo,
          player.contact,
          playerRows[index].player_id,
        ]);
      }
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// Supprime une équipe et ses joueurs (sinon les joueurs resteraient orphelins)
export async function deleteTeam(tournamentId: number, teamId: number): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [teamRows] = await connection.execute<RowDataPacket[]>(
      'SELECT id FROM teams WHERE id = ? AND tournament_id = ? LIMIT 1',
      [teamId, tournamentId],
    );
    if (teamRows.length === 0) {
      await connection.rollback();
      return;
    }

    const [playerRows] = await connection.execute<RowDataPacket[]>(
      'SELECT player_id FROM team_players WHERE team_id = ?',
      [teamId],
    );

    // La suppression de l'équipe fait tomber les lignes team_players (ON DELETE CASCADE)
    await connection.execute('DELETE FROM teams WHERE id = ?', [teamId]);

    // Puis on supprime les joueurs devenus orphelins
    for (const row of playerRows) {
      await connection.execute('DELETE FROM players WHERE id = ?', [row.player_id]);
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// Vide la liste : supprime toutes les équipes du tournoi ET leurs joueurs.
export async function deleteAllTeams(tournamentId: number): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Joueurs rattachés au tournoi via leurs équipes (avant de supprimer les équipes)
    await connection.execute(
      `DELETE p FROM players p
         JOIN team_players tp ON tp.player_id = p.id
         JOIN teams t ON t.id = tp.team_id
        WHERE t.tournament_id = ?`,
      [tournamentId],
    );
    await connection.execute('DELETE FROM teams WHERE tournament_id = ?', [tournamentId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
