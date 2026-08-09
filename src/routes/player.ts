import { Router } from 'express';

import {
  resolveIdentity,
  getBoardTeam,
  getCurrentParty,
} from '../repositories/playerBoardRepository';
import { savePartyResults } from '../repositories/partyRepository';
import { loadTournament } from '../middleware/loadTournament';
import { parseRankInputs } from '../utils/rankForm';
import { asyncHandler } from '../utils/asyncHandler';

// Interface publique destinée aux joueurs (mobile).
export const playerRouter = Router({ mergeParams: true });

playerRouter.use(loadTournament);

// Un lien de règles n'est affiché que s'il est complet (http(s) + contenu)
function validRulesUrl(url: string | null): string | null {
  return url !== null && /^https?:\/\/.+/i.test(url) ? url : null;
}

// Page d'accueil : explication + saisie du pseudo ou du nom d'équipe
playerRouter.get('/', (req, res) => {
  res.render('player/landing', {
    title: 'Espace joueur',
    error: Boolean(req.query.error),
    query: String(req.query.q ?? ''),
  });
});

// Tableau de bord du joueur (identité passée en ?q=)
playerRouter.get(
  '/board',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const query = String(req.query.q ?? '').trim();
    if (query === '') {
      res.redirect(`/tournaments/${tournamentId}/player`);
      return;
    }

    const identity = await resolveIdentity(tournamentId, query);
    if (identity === null) {
      res.redirect(`/tournaments/${tournamentId}/player?error=1&q=${encodeURIComponent(query)}`);
      return;
    }

    const team = await getBoardTeam(tournamentId, identity.teamId, identity.mePlayerId);
    if (team === null) {
      res.redirect(`/tournaments/${tournamentId}/player?error=1&q=${encodeURIComponent(query)}`);
      return;
    }

    const currentRaw = await getCurrentParty(tournamentId, identity.teamId, identity.mePlayerId);
    const current = currentRaw
      ? {
          game_name: currentRaw.game_name,
          rulesUrl: validRulesUrl(currentRaw.rules_url),
          parties: currentRaw.parties,
        }
      : null;

    res.render('player/board', { title: 'Espace joueur', team, current, query });
  }),
);

// Saisie des places d'une table depuis l'espace joueur
playerRouter.post(
  '/parties/:partyId/results',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const partyId = Number(req.params.partyId);
    const query = String(req.body.q ?? '').trim();
    const boardUrl = `/tournaments/${tournamentId}/player/board?q=${encodeURIComponent(query)}`;

    const identity = await resolveIdentity(tournamentId, query);
    if (identity === null) {
      res.redirect(`/tournaments/${tournamentId}/player`);
      return;
    }

    // On n'accepte la saisie que pour une table où le joueur est effectivement présent
    const current = await getCurrentParty(tournamentId, identity.teamId, identity.mePlayerId);
    const allowed = current !== null && current.parties.some((p) => p.id === partyId);
    if (allowed) {
      const { ranks, invalid } = parseRankInputs(req.body as Record<string, unknown>);
      if (!invalid) {
        await savePartyResults(tournamentId, partyId, ranks);
      }
    }

    res.redirect(boardUrl);
  }),
);
