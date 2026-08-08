import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { PoolConnection } from 'mysql2/promise';

import { pool } from '../db/pool';

// Un participant à une table : soit une équipe (jeu en équipe), soit un joueur (jeu solo).
export interface PartyParticipant {
  result_id: number; // id de la ligne party_results (clé de saisie des places)
  finish_rank: number | null; // place saisie (rang de compétition, null tant que non saisi)
  points: number | null; // points calculés depuis la place
  team_id: number | null;
  team_name: string | null;
  team_color: string | null;
  team_pseudos: string | null; // pseudos concaténés (fallback d'affichage si pas de nom)
  player_id: number | null;
  player_pseudo: string | null;
  player_team_color: string | null; // couleur de l'équipe du joueur (pour le repère visuel)
}

// Place saisie pour un résultat (ligne party_results)
export interface RankInput {
  resultId: number;
  rank: number;
}

// Résultat scoré : rang de compétition + points calculés.
export interface ScoredResult {
  resultId: number;
  finishRank: number;
  points: number;
}

// Barème place -> points, partagé poule/finale.
// points = N − (nb strictement mieux classés) ; ex æquo = mêmes points, rang suivant sauté.
export function competitionScores(ranks: RankInput[]): ScoredResult[] {
  const total = ranks.length;
  return ranks.map((target) => {
    const strictlyBetter = ranks.filter((other) => other.rank < target.rank).length;
    return {
      resultId: target.resultId,
      finishRank: strictlyBetter + 1,
      points: total - strictlyBetter,
    };
  });
}

// Une table de jeu tirée pour une manche, avec ses participants.
export interface Party {
  id: number;
  table_number: number;
  status: string;
  participants: PartyParticipant[];
}

// Bilan d'un tirage : nombre de tables créées et d'unités placées.
export interface DrawResult {
  tables: number;
  units: number;
}

// Mélange aléatoire (Fisher-Yates), sans muter le tableau d'entrée.
export function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Répartit `count` unités en `numTables` tables aussi égales que possible.
export function splitBalanced(count: number, numTables: number): number[] {
  const base = Math.floor(count / numTables);
  const remainder = count % numTables;
  const sizes: number[] = [];
  for (let i = 0; i < numTables; i += 1) {
    sizes.push(base + (i < remainder ? 1 : 0));
  }
  return sizes;
}

// Nombre de tables pour un jeu en équipe : assez pour respecter la capacité max,
// sans descendre sous le minimum tant qu'on peut retirer une table.
export function teamTableCount(count: number, maxPer: number, minPer: number): number {
  let numTables = Math.max(1, Math.ceil(count / maxPer));
  while (numTables > 1 && Math.floor(count / numTables) < minPer) {
    numTables -= 1;
  }
  return numTables;
}

// Répartit les joueurs d'un jeu solo sur `sizes.length` tables en garantissant
// que deux joueurs d'une même équipe ne se retrouvent jamais à la même table.
// Chaque équipe place ses joueurs sur des tables distinctes, en visant les plus
// libres (ex æquo départagés au hasard) pour équilibrer le remplissage.
export function assignSolo(teams: number[][], sizes: number[]): number[][] {
  const remaining = [...sizes];
  const tables: number[][] = sizes.map(() => []);
  const indices = sizes.map((_, i) => i);

  for (const teamPlayers of shuffle(teams)) {
    // Tables triées par capacité restante décroissante, ex æquo au hasard
    const order = shuffle(indices).sort((a, b) => remaining[b] - remaining[a]);
    const usedTables = new Set<number>();
    let placed = 0;
    for (const i of order) {
      if (placed >= teamPlayers.length) {
        break;
      }
      if (remaining[i] > 0 && !usedTables.has(i)) {
        tables[i].push(teamPlayers[placed]);
        remaining[i] -= 1;
        usedTables.add(i);
        placed += 1;
      }
    }
    // Filet de sécurité : place un reste éventuel sur une table libre non utilisée
    // par cette équipe (ne devrait pas servir tant que le nb de tables est suffisant).
    while (placed < teamPlayers.length) {
      const i = indices.find((idx) => remaining[idx] > 0 && !usedTables.has(idx));
      if (i === undefined) {
        break;
      }
      tables[i].push(teamPlayers[placed]);
      remaining[i] -= 1;
      usedTables.add(i);
      placed += 1;
    }
  }

  return tables;
}

// Garantit l'existence de la poule unique du tournoi et renvoie son id.
async function ensurePoolId(connection: PoolConnection, tournamentId: number): Promise<number> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    'SELECT id FROM pools WHERE tournament_id = ? ORDER BY id LIMIT 1',
    [tournamentId],
  );
  if (rows.length > 0) {
    return rows[0].id as number;
  }
  const [result] = await connection.execute<ResultSetHeader>(
    "INSERT INTO pools (tournament_id, name) VALUES (?, 'Poule unique')",
    [tournamentId],
  );
  return result.insertId;
}

// (Re)tire les tables d'une manche : efface les parties existantes, répartit
// aléatoirement les équipes (jeu en équipe) ou les joueurs (jeu solo) sur les tables.
export async function drawRound(tournamentId: number, roundId: number): Promise<DrawResult> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [roundRows] = await connection.execute<RowDataPacket[]>(
      `SELECT g.is_team_game, g.min_players, g.max_players
         FROM pool_rounds r
         JOIN games g ON g.id = r.game_id
        WHERE r.id = ? AND r.tournament_id = ? LIMIT 1`,
      [roundId, tournamentId],
    );
    if (roundRows.length === 0) {
      // Manche inconnue pour ce tournoi
      await connection.rollback();
      return { tables: 0, units: 0 };
    }
    const round = roundRows[0];
    const isTeam = round.is_team_game === 1;

    const poolId = await ensurePoolId(connection, tournamentId);

    // On repart d'une ardoise vierge pour cette manche (tables + résultats en cascade)
    await connection.execute('DELETE FROM parties WHERE pool_round_id = ? AND pool_id = ?', [
      roundId,
      poolId,
    ]);

    // Construit les tables (liste d'unités par table) selon le type de jeu.
    // Jeu en équipe : l'unité est l'équipe (ses 2 joueurs restent donc ensemble).
    // Jeu solo : l'unité est le joueur, avec séparation des coéquipiers.
    let tables: number[][];
    let unitCount: number;

    if (isTeam) {
      const [teamRows] = await connection.execute<RowDataPacket[]>(
        'SELECT id FROM teams WHERE tournament_id = ?',
        [tournamentId],
      );
      const teamIds = teamRows.map((r) => r.id as number);
      unitCount = teamIds.length;
      if (unitCount === 0) {
        await connection.commit();
        return { tables: 0, units: 0 };
      }

      // Capacité en équipes : joueurs par table ÷ 2 (une équipe = 2 joueurs)
      const maxPer = Math.max(1, Math.floor(round.max_players / 2));
      const minPer = Math.max(1, Math.floor(round.min_players / 2));
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
           FROM players p
           JOIN team_players tp ON tp.player_id = p.id
           JOIN teams t ON t.id = tp.team_id
          WHERE t.tournament_id = ?`,
        [tournamentId],
      );
      unitCount = playerRows.length;
      if (unitCount === 0) {
        await connection.commit();
        return { tables: 0, units: 0 };
      }

      // Regroupe les joueurs par équipe (pour séparer les coéquipiers au tirage)
      const byTeam = new Map<number, number[]>();
      for (const row of playerRows) {
        const teamId = row.team_id as number;
        const list = byTeam.get(teamId) ?? [];
        list.push(row.player_id as number);
        byTeam.set(teamId, list);
      }
      const teamGroups = [...byTeam.values()];

      // Au moins 2 tables pour pouvoir séparer les 2 joueurs d'une équipe
      const maxPer = round.max_players;
      let numTables = Math.max(Math.ceil(unitCount / maxPer), unitCount >= 2 ? 2 : 1);
      numTables = Math.min(numTables, unitCount); // jamais de table vide
      const sizes = splitBalanced(unitCount, numTables);

      tables = assignSolo(teamGroups, sizes);
    }

    // Insertion des tables et de leurs participants
    for (let t = 0; t < tables.length; t += 1) {
      const [partyResult] = await connection.execute<ResultSetHeader>(
        "INSERT INTO parties (pool_round_id, pool_id, table_number, status) VALUES (?, ?, ?, 'pending')",
        [roundId, poolId, t + 1],
      );
      const partyId = partyResult.insertId;

      for (const unitId of tables[t]) {
        if (isTeam) {
          await connection.execute('INSERT INTO party_results (party_id, team_id) VALUES (?, ?)', [
            partyId,
            unitId,
          ]);
        } else {
          await connection.execute('INSERT INTO party_results (party_id, player_id) VALUES (?, ?)', [
            partyId,
            unitId,
          ]);
        }
      }
    }

    await connection.commit();
    return { tables: tables.length, units: unitCount };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// Efface les tables tirées pour une manche (borné à la poule du tournoi)
export async function clearRound(tournamentId: number, roundId: number): Promise<void> {
  await pool.execute(
    `DELETE pa FROM parties pa
       JOIN pools po ON po.id = pa.pool_id
      WHERE pa.pool_round_id = ? AND po.tournament_id = ?`,
    [roundId, tournamentId],
  );
}

// Liste les tables d'une manche avec leurs participants, prêtes pour l'affichage
export async function listPartiesForRound(
  tournamentId: number,
  roundId: number,
): Promise<Party[]> {
  const [partyRows] = await pool.execute<RowDataPacket[]>(
    `SELECT pa.id, pa.table_number, pa.status
       FROM parties pa
       JOIN pools po ON po.id = pa.pool_id
      WHERE pa.pool_round_id = ? AND po.tournament_id = ?
      ORDER BY pa.table_number`,
    [roundId, tournamentId],
  );
  if (partyRows.length === 0) {
    return [];
  }

  const partyIds = partyRows.map((r) => r.id as number);

  // query() (et non execute) développe le tableau pour la clause IN (?)
  const [resultRows] = await pool.query<RowDataPacket[]>(
    `SELECT pr.party_id, pr.id AS result_id, pr.finish_rank, pr.points,
            pr.team_id, t.name AS team_name, t.color AS team_color,
            (SELECT GROUP_CONCAT(pp.pseudo ORDER BY pp.id SEPARATOR ' & ')
               FROM team_players tp JOIN players pp ON pp.id = tp.player_id
              WHERE tp.team_id = pr.team_id) AS team_pseudos,
            pr.player_id, pl.pseudo AS player_pseudo, plt.color AS player_team_color
       FROM party_results pr
       LEFT JOIN teams t ON t.id = pr.team_id
       LEFT JOIN players pl ON pl.id = pr.player_id
       LEFT JOIN team_players ptp ON ptp.player_id = pr.player_id
       LEFT JOIN teams plt ON plt.id = ptp.team_id
      WHERE pr.party_id IN (?)
      ORDER BY pr.party_id, pr.finish_rank IS NULL, pr.finish_rank, pr.id`,
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

// Enregistre les places d'une partie et calcule les points de chaque participant.
// Barème : points = N − (nb de participants strictement mieux classés), N = nb de participants.
// Les ex æquo (même place saisie) reçoivent les mêmes points, le rang suivant est sauté.
// Renvoie false si la partie n'appartient pas au tournoi ou si toutes les places ne sont pas fournies.
export async function savePartyResults(
  tournamentId: number,
  partyId: number,
  ranks: RankInput[],
): Promise<boolean> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Résultats de cette partie, bornés au tournoi (empêche toute saisie croisée)
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT pr.id
         FROM party_results pr
         JOIN parties pa ON pa.id = pr.party_id
         JOIN pools po ON po.id = pa.pool_id
        WHERE pr.party_id = ? AND po.tournament_id = ?`,
      [partyId, tournamentId],
    );
    if (rows.length === 0) {
      await connection.rollback();
      return false;
    }

    const validIds = new Set(rows.map((r) => r.id as number));
    const filtered = ranks.filter((r) => validIds.has(r.resultId));
    // On exige une place pour chaque participant, une seule fois chacun
    const uniqueIds = new Set(filtered.map((r) => r.resultId));
    if (uniqueIds.size !== validIds.size) {
      await connection.rollback();
      return false;
    }

    for (const scored of competitionScores(filtered)) {
      await connection.execute(
        'UPDATE party_results SET finish_rank = ?, points = ? WHERE id = ?',
        [scored.finishRank, scored.points, scored.resultId],
      );
    }

    await connection.execute("UPDATE parties SET status = 'validated' WHERE id = ?", [partyId]);

    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
