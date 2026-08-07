import { Router } from 'express';

import {
  listTournaments,
  createTournament,
  closeTournament,
} from '../repositories/tournamentRepository';
import { asyncHandler } from '../utils/asyncHandler';

export const tournamentsRouter = Router();

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

// Création d'un tournoi
tournamentsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const name = String(req.body.name ?? '').trim();
    if (name === '') {
      // Nom manquant : on réaffiche le formulaire avec un message
      res
        .status(400)
        .render('tournaments/new', { title: 'Nouveau tournoi', error: 'Le nom est obligatoire.' });
      return;
    }
    await createTournament(name);
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
