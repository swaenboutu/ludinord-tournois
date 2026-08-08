import { Router } from 'express';

import { getTournament } from '../repositories/tournamentRepository';
import { listPoolRounds } from '../repositories/poolRoundRepository';
import { listPoolStandings } from '../repositories/standingsRepository';
import { asyncHandler } from '../utils/asyncHandler';

// Écrans d'affichage public (télé) — plein écran, sans navigation admin.
export const displayRouter = Router({ mergeParams: true });

// Middleware : charge le tournoi parent (404 sinon) et le partage aux vues
displayRouter.use(
  asyncHandler(async (req, res, next) => {
    const tournament = await getTournament(Number(req.params.tournamentId));
    if (tournament === null) {
      res.status(404).send('Tournoi introuvable');
      return;
    }
    res.locals.tournament = tournament;
    next();
  }),
);

// Accueil des écrans disponibles
displayRouter.get('/', (_req, res) => {
  res.render('display/index');
});

// Écran phase de poule : jeu en cours, jeu suivant, classement des équipes
displayRouter.get(
  '/pool',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const rounds = await listPoolRounds(tournamentId);

    // "Jeu en cours" = première manche non terminée (tables non toutes validées).
    // Une manche sans tables tirées compte aussi comme non terminée.
    const currentIndex = rounds.findIndex(
      (r) => !(r.table_count > 0 && r.validated_count === r.table_count),
    );
    const current = currentIndex >= 0 ? rounds[currentIndex] : null;
    const next =
      currentIndex >= 0 && currentIndex + 1 < rounds.length ? rounds[currentIndex + 1] : null;

    // Toutes les manches jouées (il y en a, et plus aucune en cours)
    const finished = rounds.length > 0 && current === null;

    const standings = await listPoolStandings(tournamentId);
    res.render('display/pool', { current, next, standings, finished });
  }),
);
