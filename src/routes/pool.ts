import { Router } from 'express';

import { getTournament } from '../repositories/tournamentRepository';
import {
  listPoolRounds,
  getPoolRound,
  listEligibleGames,
  addPoolRound,
  removePoolRound,
  movePoolRound,
} from '../repositories/poolRoundRepository';
import { drawRound, clearRound, listPartiesForRound } from '../repositories/partyRepository';
import { asyncHandler } from '../utils/asyncHandler';

// mergeParams : rend req.params.tournamentId (du chemin de montage) accessible ici
export const poolRouter = Router({ mergeParams: true });

// Middleware : charge le tournoi parent (404 sinon) et le partage aux vues via res.locals
poolRouter.use(
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

// Vue d'ensemble : manches ordonnées + jeux ajoutables
poolRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const rounds = await listPoolRounds(tournamentId);
    const eligibleGames = await listEligibleGames(tournamentId);
    res.render('pool/index', { title: 'Phase de poule', rounds, eligibleGames });
  }),
);

// Ajout d'un jeu comme nouvelle manche
poolRouter.post(
  '/rounds',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const gameId = Number(req.body.game_id);
    if (Number.isInteger(gameId)) {
      await addPoolRound(tournamentId, gameId);
    }
    res.redirect(`/tournaments/${tournamentId}/pool`);
  }),
);

// Réordonnancement d'une manche (haut/bas)
poolRouter.post(
  '/rounds/:roundId/move',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const direction = req.body.direction === 'up' ? 'up' : 'down';
    await movePoolRound(tournamentId, Number(req.params.roundId), direction);
    res.redirect(`/tournaments/${tournamentId}/pool`);
  }),
);

// Suppression d'une manche
poolRouter.post(
  '/rounds/:roundId/delete',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    await removePoolRound(tournamentId, Number(req.params.roundId));
    res.redirect(`/tournaments/${tournamentId}/pool`);
  }),
);

// (Re)tirage des tables d'une manche
poolRouter.post(
  '/rounds/:roundId/draw',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const roundId = Number(req.params.roundId);
    await drawRound(tournamentId, roundId);
    res.redirect(`/tournaments/${tournamentId}/pool/rounds/${roundId}/parties`);
  }),
);

// Effacement des tables d'une manche
poolRouter.post(
  '/rounds/:roundId/clear',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const roundId = Number(req.params.roundId);
    await clearRound(tournamentId, roundId);
    res.redirect(`/tournaments/${tournamentId}/pool/rounds/${roundId}/parties`);
  }),
);

// Liste des tables (parties) d'une manche, avec leurs participants
poolRouter.get(
  '/rounds/:roundId/parties',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const roundId = Number(req.params.roundId);
    const round = await getPoolRound(tournamentId, roundId);
    if (round === null) {
      res.status(404).send('Manche introuvable');
      return;
    }
    const rounds = await listPoolRounds(tournamentId);
    const position = rounds.findIndex((r) => r.id === roundId) + 1;
    const parties = await listPartiesForRound(tournamentId, roundId);
    res.render('pool/parties', { title: round.game_name, round, position, parties });
  }),
);
