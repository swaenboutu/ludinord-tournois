import { RankInput } from '../repositories/partyRepository';

// Extrait les places saisies depuis le corps du formulaire (champs "rank_<resultId>").
// invalid = true si une place est absente ou n'est pas un entier >= 1.
// Partagé par la saisie des résultats de poule et de finale.
export function parseRankInputs(body: Record<string, unknown>): {
  ranks: RankInput[];
  invalid: boolean;
} {
  const ranks: RankInput[] = [];
  let invalid = false;

  for (const key of Object.keys(body)) {
    if (!key.startsWith('rank_')) {
      continue;
    }
    const resultId = Number(key.slice('rank_'.length));
    const raw = String(body[key] ?? '').trim();
    const value = Number(raw);
    if (!Number.isInteger(resultId) || raw === '' || !Number.isInteger(value) || value < 1) {
      invalid = true;
    } else {
      ranks.push({ resultId, rank: value });
    }
  }

  return { ranks, invalid };
}
