import { RequestHandler } from 'express';

import { getTournament } from '../repositories/tournamentRepository';
import { asyncHandler } from '../utils/asyncHandler';

// Middleware partagé : charge le tournoi parent (via :tournamentId), répond 404 s'il
// n'existe pas, et le partage aux vues via res.locals.tournament.
export const loadTournament: RequestHandler = asyncHandler(async (req, res, next) => {
  const tournament = await getTournament(Number(req.params.tournamentId));
  if (tournament === null) {
    res.status(404).send('Tournoi introuvable');
    return;
  }
  res.locals.tournament = tournament;
  next();
});
