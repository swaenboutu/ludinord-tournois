import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { PoolConnection } from 'mysql2/promise';

import { pool } from '../db/pool';
import {
  POOL_SCHEMA,
  Party,
  RankInput,
  ScoredResult,
  listPartiesForRound as coreListPartiesForRound,
  saveResults as coreSaveResults,
  clearRound as coreClearRound,
} from './phaseCore';

// Types partagés poule/finale, ré-exportés pour les importateurs existants.
export type { Party, PartyParticipant, RankInput, ScoredResult } from './phaseCore';

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
      `SELECT g.is_team_game, g.min_players, g.max_players, tr.team_size
         FROM pool_rounds r
         JOIN games g ON g.id = r.game_id
         JOIN tournaments tr ON tr.id = r.tournament_id
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
    const teamSize = Math.max(1, Number(round.team_size));

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

      // Capacité en équipes : joueurs par table ÷ taille d'équipe
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

      // Au moins `teamSize` tables pour séparer tous les coéquipiers d'une équipe
      const maxPer = round.max_players;
      const minSeparationTables = teamSize >= 2 ? teamSize : 1;
      let numTables = Math.max(Math.ceil(unitCount / maxPer), minSeparationTables);
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
  await coreClearRound(POOL_SCHEMA, tournamentId, roundId);
}

// Liste les tables d'une manche avec leurs participants, prêtes pour l'affichage
export async function listPartiesForRound(
  tournamentId: number,
  roundId: number,
): Promise<Party[]> {
  return coreListPartiesForRound(POOL_SCHEMA, tournamentId, roundId);
}

// Enregistre les places d'une partie et calcule les points (barème partagé).
// Renvoie les scores calculés, ou null si la partie n'appartient pas au tournoi
// ou si toutes les places ne sont pas fournies.
export async function savePartyResults(
  tournamentId: number,
  partyId: number,
  ranks: RankInput[],
): Promise<ScoredResult[] | null> {
  return coreSaveResults(POOL_SCHEMA, tournamentId, partyId, ranks);
}
