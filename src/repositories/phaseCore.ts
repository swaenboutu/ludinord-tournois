import { RowDataPacket } from 'mysql2';

import { pool } from '../db/pool';

// =====================================================================
//  Cœur partagé poule / finale : gestion des manches, tables et résultats.
//  Les deux phases ont des tables jumelles (pool_rounds/final_rounds,
//  parties/final_parties, party_results/final_party_results). Ce module
//  implémente une seule fois la logique identique, paramétrée par un
//  "schéma de phase". Les noms de tables/colonnes proviennent UNIQUEMENT
//  des constantes ci-dessous (jamais d'entrée utilisateur) : leur
//  interpolation dans le SQL est donc sûre.
// =====================================================================

// Décrit les tables/colonnes et les jointures d'appartenance d'une phase.
export interface PhaseSchema {
  roundsTable: string; // pool_rounds | final_rounds
  roundScopeCol: string; // tournament_id | stage_id (parent direct d'une manche)
  partiesTable: string; // parties | final_parties
  partyRoundCol: string; // pool_round_id | final_round_id
  resultsTable: string; // party_results | final_party_results
  resultPartyCol: string; // party_id | final_party_id
  availability: string[]; // valeurs de games.availability acceptées
  roundOwnershipJoin: string; // jointure manche -> tournoi (alias r)
  roundOwnershipCol: string; // colonne tournament_id atteinte via roundOwnershipJoin
  partyOwnershipJoin: string; // jointure table (alias pa) -> tournoi
  partyOwnershipCol: string; // colonne tournament_id atteinte via partyOwnershipJoin
}

// Schéma de la phase de poule.
export const POOL_SCHEMA: PhaseSchema = {
  roundsTable: 'pool_rounds',
  roundScopeCol: 'tournament_id',
  partiesTable: 'parties',
  partyRoundCol: 'pool_round_id',
  resultsTable: 'party_results',
  resultPartyCol: 'party_id',
  availability: ['pool', 'both'],
  roundOwnershipJoin: '',
  roundOwnershipCol: 'r.tournament_id',
  partyOwnershipJoin: 'JOIN pools po ON po.id = pa.pool_id',
  partyOwnershipCol: 'po.tournament_id',
};

// Schéma de la phase finale (manche rattachée à une étape, elle-même à un tournoi).
export const FINAL_SCHEMA: PhaseSchema = {
  roundsTable: 'final_rounds',
  roundScopeCol: 'stage_id',
  partiesTable: 'final_parties',
  partyRoundCol: 'final_round_id',
  resultsTable: 'final_party_results',
  resultPartyCol: 'final_party_id',
  availability: ['final', 'both'],
  roundOwnershipJoin: 'JOIN final_stages s ON s.id = r.stage_id',
  roundOwnershipCol: 's.tournament_id',
  partyOwnershipJoin:
    'JOIN final_rounds fr ON fr.id = pa.final_round_id JOIN final_stages fs ON fs.id = fr.stage_id',
  partyOwnershipCol: 'fs.tournament_id',
};

// Liste de valeurs SQL sûre (valeurs issues des constantes de schéma).
function quotedList(values: string[]): string {
  return values.map((v) => `'${v}'`).join(', ');
}

// ---------- Types partagés ----------

// Une manche générique (le parent est tournoi en poule, étape en finale).
export interface RoundRow {
  id: number;
  scope_id: number;
  game_id: number;
  round_order: number;
  game_name: string;
  is_team_game: boolean;
  min_players: number;
  max_players: number;
  table_count: number;
  validated_count: number;
}

// Un participant à une table : équipe (jeu en équipe) ou joueur (jeu solo).
export interface PartyParticipant {
  result_id: number;
  finish_rank: number | null;
  points: number | null;
  team_id: number | null;
  team_name: string | null;
  team_color: string | null;
  team_pseudos: string | null;
  player_id: number | null;
  player_pseudo: string | null;
  player_team_color: string | null;
}

// Une table tirée, avec ses participants.
export interface Party {
  id: number;
  table_number: number;
  status: string;
  participants: PartyParticipant[];
}

// Place saisie pour un résultat.
export interface RankInput {
  resultId: number;
  rank: number;
}

// Résultat scoré : rang de compétition + points.
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

// ---------- Manches ----------

const roundSelect = (schema: PhaseSchema): string => `
  SELECT r.id, r.${schema.roundScopeCol} AS scope_id, r.game_id, r.round_order,
         g.name AS game_name, g.is_team_game, g.min_players, g.max_players,
         (SELECT COUNT(*) FROM ${schema.partiesTable} pa WHERE pa.${schema.partyRoundCol} = r.id) AS table_count,
         (SELECT COUNT(*) FROM ${schema.partiesTable} pa
           WHERE pa.${schema.partyRoundCol} = r.id AND pa.status = 'validated') AS validated_count
    FROM ${schema.roundsTable} r
    JOIN games g ON g.id = r.game_id`;

function mapRoundRow(row: RowDataPacket): RoundRow {
  return {
    id: row.id,
    scope_id: row.scope_id,
    game_id: row.game_id,
    round_order: row.round_order,
    game_name: row.game_name,
    is_team_game: row.is_team_game === 1,
    min_players: row.min_players,
    max_players: row.max_players,
    table_count: Number(row.table_count),
    validated_count: Number(row.validated_count),
  };
}

// Manches d'une phase (scope = tournoi en poule, étape en finale), triées.
export async function listRounds(schema: PhaseSchema, scopeId: number): Promise<RoundRow[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `${roundSelect(schema)} WHERE r.${schema.roundScopeCol} = ? ORDER BY r.round_order`,
    [scopeId],
  );
  return rows.map(mapRoundRow);
}

// Une manche précise, bornée au tournoi, ou null.
export async function getRound(
  schema: PhaseSchema,
  tournamentId: number,
  roundId: number,
): Promise<RoundRow | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `${roundSelect(schema)} ${schema.roundOwnershipJoin}
      WHERE r.id = ? AND ${schema.roundOwnershipCol} = ? LIMIT 1`,
    [roundId, tournamentId],
  );
  const row = rows[0];
  return row ? mapRoundRow(row) : null;
}

// Jeux ajoutables comme manche (dispo pour la phase, pas déjà retenus dans le scope).
export async function listEligibleGames(
  schema: PhaseSchema,
  tournamentId: number,
  scopeId: number,
): Promise<{ id: number; name: string }[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT g.id, g.name
       FROM games g
      WHERE g.tournament_id = ?
        AND g.availability IN (${quotedList(schema.availability)})
        AND g.id NOT IN (SELECT game_id FROM ${schema.roundsTable} WHERE ${schema.roundScopeCol} = ?)
      ORDER BY g.name`,
    [tournamentId, scopeId],
  );
  return rows.map((r) => ({ id: r.id as number, name: r.name as string }));
}

// Ajoute un jeu en fin de manches (ignore si jeu invalide ou déjà présent).
export async function addRound(
  schema: PhaseSchema,
  tournamentId: number,
  scopeId: number,
  gameId: number,
): Promise<void> {
  const [games] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM games
      WHERE id = ? AND tournament_id = ? AND availability IN (${quotedList(schema.availability)}) LIMIT 1`,
    [gameId, tournamentId],
  );
  if (games.length === 0) {
    return;
  }
  const [exists] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM ${schema.roundsTable} WHERE ${schema.roundScopeCol} = ? AND game_id = ? LIMIT 1`,
    [scopeId, gameId],
  );
  if (exists.length > 0) {
    return;
  }
  const [maxRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COALESCE(MAX(round_order), 0) + 1 AS next FROM ${schema.roundsTable} WHERE ${schema.roundScopeCol} = ?`,
    [scopeId],
  );
  await pool.execute(
    `INSERT INTO ${schema.roundsTable} (${schema.roundScopeCol}, game_id, round_order) VALUES (?, ?, ?)`,
    [scopeId, gameId, Number(maxRows[0].next)],
  );
}

// Retire une manche (les tables tombent en cascade).
export async function removeRound(
  schema: PhaseSchema,
  scopeId: number,
  roundId: number,
): Promise<void> {
  await pool.execute(
    `DELETE FROM ${schema.roundsTable} WHERE id = ? AND ${schema.roundScopeCol} = ?`,
    [roundId, scopeId],
  );
}

// Déplace une manche (échange de rang avec sa voisine, via un rang temporaire libre).
export async function moveRound(
  schema: PhaseSchema,
  scopeId: number,
  roundId: number,
  direction: 'up' | 'down',
): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, round_order FROM ${schema.roundsTable} WHERE ${schema.roundScopeCol} = ? ORDER BY round_order`,
      [scopeId],
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
      `SELECT COALESCE(MAX(round_order), 0) + 1 AS temp FROM ${schema.roundsTable} WHERE ${schema.roundScopeCol} = ?`,
      [scopeId],
    );
    const temp = Number(maxRows[0].temp);
    await connection.execute(`UPDATE ${schema.roundsTable} SET round_order = ? WHERE id = ?`, [
      temp,
      current.id,
    ]);
    await connection.execute(`UPDATE ${schema.roundsTable} SET round_order = ? WHERE id = ?`, [
      current.round_order,
      neighbor.id,
    ]);
    await connection.execute(`UPDATE ${schema.roundsTable} SET round_order = ? WHERE id = ?`, [
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

// ---------- Tables (parties) et résultats ----------

// Liste les tables d'une manche avec leurs participants (bornées au tournoi).
export async function listPartiesForRound(
  schema: PhaseSchema,
  tournamentId: number,
  roundId: number,
): Promise<Party[]> {
  const [partyRows] = await pool.execute<RowDataPacket[]>(
    `SELECT pa.id, pa.table_number, pa.status
       FROM ${schema.partiesTable} pa
       ${schema.partyOwnershipJoin}
      WHERE pa.${schema.partyRoundCol} = ? AND ${schema.partyOwnershipCol} = ?
      ORDER BY pa.table_number`,
    [roundId, tournamentId],
  );
  if (partyRows.length === 0) {
    return [];
  }
  const partyIds = partyRows.map((r) => r.id as number);

  const [resultRows] = await pool.query<RowDataPacket[]>(
    `SELECT pr.${schema.resultPartyCol} AS party_id, pr.id AS result_id, pr.finish_rank, pr.points,
            pr.team_id, t.name AS team_name, t.color AS team_color,
            (SELECT GROUP_CONCAT(pp.pseudo ORDER BY pp.id SEPARATOR ' & ')
               FROM team_players tp JOIN players pp ON pp.id = tp.player_id
              WHERE tp.team_id = pr.team_id) AS team_pseudos,
            pr.player_id, pl.pseudo AS player_pseudo, plt.color AS player_team_color
       FROM ${schema.resultsTable} pr
       LEFT JOIN teams t ON t.id = pr.team_id
       LEFT JOIN players pl ON pl.id = pr.player_id
       LEFT JOIN team_players ptp ON ptp.player_id = pr.player_id
       LEFT JOIN teams plt ON plt.id = ptp.team_id
      WHERE pr.${schema.resultPartyCol} IN (?)
      ORDER BY pr.${schema.resultPartyCol}, pr.finish_rank IS NULL, pr.finish_rank, pr.id`,
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

// Enregistre les places d'une table et calcule les points. Renvoie les scores,
// ou null si la table n'appartient pas au tournoi / si une place manque.
export async function saveResults(
  schema: PhaseSchema,
  tournamentId: number,
  partyId: number,
  ranks: RankInput[],
): Promise<ScoredResult[] | null> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT pr.id
         FROM ${schema.resultsTable} pr
         JOIN ${schema.partiesTable} pa ON pa.id = pr.${schema.resultPartyCol}
         ${schema.partyOwnershipJoin}
        WHERE pr.${schema.resultPartyCol} = ? AND ${schema.partyOwnershipCol} = ?`,
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
        `UPDATE ${schema.resultsTable} SET finish_rank = ?, points = ? WHERE id = ?`,
        [scored.finishRank, scored.points, scored.resultId],
      );
    }
    await connection.execute(
      `UPDATE ${schema.partiesTable} SET status = 'validated' WHERE id = ?`,
      [partyId],
    );

    await connection.commit();
    return scores;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// Efface les tables d'une manche (bornées au tournoi).
export async function clearRound(
  schema: PhaseSchema,
  tournamentId: number,
  roundId: number,
): Promise<void> {
  await pool.execute(
    `DELETE pa FROM ${schema.partiesTable} pa
       ${schema.partyOwnershipJoin}
      WHERE pa.${schema.partyRoundCol} = ? AND ${schema.partyOwnershipCol} = ?`,
    [roundId, tournamentId],
  );
}
