import {
  POOL_SCHEMA,
  RoundRow,
  listRounds,
  getRound,
  listEligibleGames as coreListEligibleGames,
  addRound,
  removeRound,
  moveRound,
} from './phaseCore';

// Une manche de poule : un jeu à jouer, à un rang donné, commun à tout le tournoi.
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
  validated_count: number; // nb de tables aux résultats saisis (status = validated)
}

// Adapte une manche générique en manche de poule (scope = tournoi).
function toPoolRound(row: RoundRow): PoolRound {
  return {
    id: row.id,
    tournament_id: row.scope_id,
    game_id: row.game_id,
    round_order: row.round_order,
    game_name: row.game_name,
    is_team_game: row.is_team_game,
    min_players: row.min_players,
    max_players: row.max_players,
    table_count: row.table_count,
    validated_count: row.validated_count,
  };
}

// Liste les manches d'un tournoi, dans l'ordre de passage.
export async function listPoolRounds(tournamentId: number): Promise<PoolRound[]> {
  const rows = await listRounds(POOL_SCHEMA, tournamentId);
  return rows.map(toPoolRound);
}

// Récupère une manche précise d'un tournoi, ou null.
export async function getPoolRound(
  tournamentId: number,
  roundId: number,
): Promise<PoolRound | null> {
  const row = await getRound(POOL_SCHEMA, tournamentId, roundId);
  return row ? toPoolRound(row) : null;
}

// Jeux qu'on peut encore ajouter comme manche (présents en poule, pas déjà retenus).
export async function listEligibleGames(
  tournamentId: number,
): Promise<{ id: number; name: string }[]> {
  return coreListEligibleGames(POOL_SCHEMA, tournamentId, tournamentId);
}

// Ajoute un jeu en fin de liste des manches (ignore si jeu invalide ou déjà présent).
export async function addPoolRound(tournamentId: number, gameId: number): Promise<void> {
  await addRound(POOL_SCHEMA, tournamentId, tournamentId, gameId);
}

// Retire une manche (les parties tirées tombent en cascade).
export async function removePoolRound(tournamentId: number, roundId: number): Promise<void> {
  await removeRound(POOL_SCHEMA, tournamentId, roundId);
}

// Déplace une manche vers le haut/bas en échangeant son rang avec sa voisine.
export async function movePoolRound(
  tournamentId: number,
  roundId: number,
  direction: 'up' | 'down',
): Promise<void> {
  await moveRound(POOL_SCHEMA, tournamentId, roundId, direction);
}
