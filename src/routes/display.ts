import { Router } from 'express';

import { listPoolRounds } from '../repositories/poolRoundRepository';
import { listPoolStandings } from '../repositories/standingsRepository';
import { listFinalStages, getStageStandings } from '../repositories/finalRepository';
import { loadTournament } from '../middleware/loadTournament';
import { asyncHandler } from '../utils/asyncHandler';

// Écrans d'affichage public (télé) — plein écran, sans navigation admin.
export const displayRouter = Router({ mergeParams: true });

// Charge le tournoi parent (404 sinon) et le partage aux vues
displayRouter.use(loadTournament);

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

// Écran phase finale : arbre des étapes, des premières jusqu'à la demi-finale.
// La dernière étape (la finale) est exclue — elle aura son propre écran.
displayRouter.get(
  '/final',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const stages = await listFinalStages(tournamentId);
    const shown = stages.slice(0, -1); // on retire la finale

    const bracket = [];
    for (const stage of shown) {
      const standings = await getStageStandings(stage.id);
      bracket.push({ stage, standings, qualifyCount: Math.floor(stage.team_count / 2) });
    }

    res.render('display/final', { bracket });
  }),
);
