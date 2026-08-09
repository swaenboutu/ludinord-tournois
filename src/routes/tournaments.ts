import { Router } from 'express';

import {
  listTournaments,
  getTournament,
  createTournament,
  closeTournament,
} from '../repositories/tournamentRepository';
import { requireAuth } from '../middleware/requireAuth';
import { asyncHandler } from '../utils/asyncHandler';

export const tournamentsRouter = Router();

// Toutes les routes de gestion des tournois exigent une session admin
tournamentsRouter.use(requireAuth);

// Liste des tournois
tournamentsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const tournaments = await listTournaments();
    res.render('tournaments/list', { title: 'Tournois', tournaments });
  }),
);

// Formulaire de création
tournamentsRouter.get('/new', (_req, res) => {
  res.render('tournaments/new', { title: 'Nouveau tournoi' });
});

// Détail / hub de configuration d'un tournoi (défini après /new pour ne pas le capturer)
tournamentsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const tournament = await getTournament(Number(req.params.id));
    if (tournament === null) {
      res.status(404).send('Tournoi introuvable');
      return;
    }
    res.render('tournaments/show', { title: tournament.name, tournament });
  }),
);

// Création d'un tournoi
tournamentsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const name = String(req.body.name ?? '').trim();
    const teamSize = Number(req.body.team_size);
    if (name === '') {
      // Nom manquant : on réaffiche le formulaire avec un message
      res.status(400).render('tournaments/new', {
        title: 'Nouveau tournoi',
        error: 'Le nom est obligatoire.',
      });
      return;
    }
    if (!Number.isInteger(teamSize) || teamSize < 1) {
      res.status(400).render('tournaments/new', {
        title: 'Nouveau tournoi',
        error: 'Le nombre de joueurs par équipe doit être un entier supérieur ou égal à 1.',
      });
      return;
    }
    await createTournament(name, teamSize);
    res.redirect('/tournaments');
  }),
);

// Clôture d'un tournoi
tournamentsRouter.post(
  '/:id/close',
  asyncHandler(async (req, res) => {
    await closeTournament(Number(req.params.id));
    res.redirect('/tournaments');
  }),
);
