import { Router } from 'express';

import {
  listPoolRounds,
  getPoolRound,
  listEligibleGames,
  addPoolRound,
  removePoolRound,
  movePoolRound,
} from '../repositories/poolRoundRepository';
import {
  drawRound,
  clearRound,
  listPartiesForRound,
  savePartyResults,
} from '../repositories/partyRepository';
import { listPoolStandings } from '../repositories/standingsRepository';
import { loadTournament } from '../middleware/loadTournament';
import { parseRankInputs } from '../utils/rankForm';
import { asyncHandler } from '../utils/asyncHandler';

// mergeParams : rend req.params.tournamentId (du chemin de montage) accessible ici
export const poolRouter = Router({ mergeParams: true });

// Charge le tournoi parent (404 sinon) et le partage aux vues
poolRouter.use(loadTournament);

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

// Classement de la poule (cumul des points par équipe)
poolRouter.get(
  '/standings',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const standings = await listPoolStandings(tournamentId);
    res.render('pool/standings', { title: 'Classement de la poule', standings });
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
    res.render('pool/parties', { title: round.game_name, round, position, parties, error: null });
  }),
);

// Saisie des places d'une partie -> calcul et enregistrement des points
poolRouter.post(
  '/parties/:partyId/results',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const partyId = Number(req.params.partyId);
    const roundId = Number(req.body.round_id);

    const { ranks, invalid } = parseRankInputs(req.body as Record<string, unknown>);
    const scored = invalid ? null : await savePartyResults(tournamentId, partyId, ranks);

    // Soumission AJAX : réponse JSON, sans rechargement de la page
    if (req.xhr) {
      if (scored === null) {
        res.status(400).json({ ok: false, error: 'Places invalides.' });
      } else {
        res.json({ ok: true, results: scored, status: 'validated' });
      }
      return;
    }

    // Repli sans JS : redirection si OK
    if (scored !== null) {
      res.redirect(`/tournaments/${tournamentId}/pool/rounds/${roundId}/parties`);
      return;
    }

    // Échec : on réaffiche la manche avec un message (les places ne sont pas enregistrées)
    const round = await getPoolRound(tournamentId, roundId);
    if (round === null) {
      res.redirect(`/tournaments/${tournamentId}/pool`);
      return;
    }
    const rounds = await listPoolRounds(tournamentId);
    const position = rounds.findIndex((r) => r.id === roundId) + 1;
    const parties = await listPartiesForRound(tournamentId, roundId);
    res.status(400).render('pool/parties', {
      title: round.game_name,
      round,
      position,
      parties,
      error: 'Indique une place (entier ≥ 1) pour chaque participant de la table.',
    });
  }),
);
