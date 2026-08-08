import { Router } from 'express';

import { getTournament } from '../repositories/tournamentRepository';
import { listTeams } from '../repositories/teamRepository';
import { RankInput } from '../repositories/partyRepository';
import {
  START_SIZES,
  createFinalPhase,
  deleteFinalPhase,
  listFinalStages,
  getStage,
  listStageRounds,
  getFinalRound,
  listEligibleFinalGames,
  addStageRound,
  removeStageRound,
  moveStageRound,
  listStageTeams,
  qualifyFirstStage,
  drawStageRound,
  clearStageRound,
  listFinalPartiesForRound,
  saveFinalPartyResults,
  getStageStandings,
  advanceStage,
} from '../repositories/finalRepository';
import { asyncHandler } from '../utils/asyncHandler';

// mergeParams : rend req.params.tournamentId (du chemin de montage) accessible ici
export const finalRouter = Router({ mergeParams: true });

// Middleware : charge le tournoi parent (404 sinon) et le partage aux vues
finalRouter.use(
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

// Vue d'ensemble : étapes existantes, ou création de la phase finale
finalRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const stages = await listFinalStages(tournamentId);
    const teamCount = (await listTeams(tournamentId)).length;
    const sizeOptions = START_SIZES.filter((s) => s <= teamCount);
    res.render('final/index', { title: 'Phase finale', stages, teamCount, sizeOptions });
  }),
);

// Création de la phase finale (génère les étapes par division)
finalRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const startSize = Number(req.body.start_size);
    if (Number.isInteger(startSize)) {
      await createFinalPhase(tournamentId, startSize);
    }
    res.redirect(`/tournaments/${tournamentId}/final`);
  }),
);

// Suppression de la phase finale
finalRouter.post(
  '/reset',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    await deleteFinalPhase(tournamentId);
    res.redirect(`/tournaments/${tournamentId}/final`);
  }),
);

// Page d'une étape : manches, équipes qualifiées, classement
finalRouter.get(
  '/stages/:stageId',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const stageId = Number(req.params.stageId);
    const stage = await getStage(tournamentId, stageId);
    if (stage === null) {
      res.status(404).send('Étape introuvable');
      return;
    }
    const stages = await listFinalStages(tournamentId);
    const rounds = await listStageRounds(stageId);
    const eligibleGames = await listEligibleFinalGames(tournamentId, stageId);
    const teams = await listStageTeams(stageId);
    const standings = await getStageStandings(stageId);
    const hasNext = stage.stage_order < stages.length;
    const qualifyCount = Math.floor(stage.team_count / 2); // nb d'équipes qui passent (1 = champion en finale)
    res.render('final/stage', {
      title: stage.name,
      stage,
      rounds,
      eligibleGames,
      teams,
      standings,
      hasNext,
      qualifyCount,
    });
  }),
);

// Qualifie la première étape depuis le classement de poule
finalRouter.post(
  '/stages/:stageId/qualify',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const stageId = Number(req.params.stageId);
    await qualifyFirstStage(tournamentId, stageId);
    res.redirect(`/tournaments/${tournamentId}/final/stages/${stageId}`);
  }),
);

// Qualifie la moitié des équipes vers l'étape suivante
finalRouter.post(
  '/stages/:stageId/advance',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const stageId = Number(req.params.stageId);
    await advanceStage(tournamentId, stageId);
    res.redirect(`/tournaments/${tournamentId}/final/stages/${stageId}`);
  }),
);

// Ajout d'un jeu comme manche de l'étape
finalRouter.post(
  '/stages/:stageId/rounds',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const stageId = Number(req.params.stageId);
    const gameId = Number(req.body.game_id);
    if (Number.isInteger(gameId)) {
      await addStageRound(tournamentId, stageId, gameId);
    }
    res.redirect(`/tournaments/${tournamentId}/final/stages/${stageId}`);
  }),
);

// Réordonnancement d'une manche d'étape
finalRouter.post(
  '/rounds/:roundId/move',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const roundId = Number(req.params.roundId);
    const round = await getFinalRound(tournamentId, roundId);
    if (round === null) {
      res.redirect(`/tournaments/${tournamentId}/final`);
      return;
    }
    const direction = req.body.direction === 'up' ? 'up' : 'down';
    await moveStageRound(round.stage_id, roundId, direction);
    res.redirect(`/tournaments/${tournamentId}/final/stages/${round.stage_id}`);
  }),
);

// Suppression d'une manche d'étape
finalRouter.post(
  '/rounds/:roundId/delete',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const roundId = Number(req.params.roundId);
    const round = await getFinalRound(tournamentId, roundId);
    if (round === null) {
      res.redirect(`/tournaments/${tournamentId}/final`);
      return;
    }
    await removeStageRound(round.stage_id, roundId);
    res.redirect(`/tournaments/${tournamentId}/final/stages/${round.stage_id}`);
  }),
);

// (Re)tirage des tables d'une manche d'étape
finalRouter.post(
  '/rounds/:roundId/draw',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const roundId = Number(req.params.roundId);
    await drawStageRound(tournamentId, roundId);
    res.redirect(`/tournaments/${tournamentId}/final/rounds/${roundId}/parties`);
  }),
);

// Effacement des tables d'une manche d'étape
finalRouter.post(
  '/rounds/:roundId/clear',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const roundId = Number(req.params.roundId);
    await clearStageRound(tournamentId, roundId);
    res.redirect(`/tournaments/${tournamentId}/final/rounds/${roundId}/parties`);
  }),
);

// Liste des tables d'une manche d'étape
finalRouter.get(
  '/rounds/:roundId/parties',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const roundId = Number(req.params.roundId);
    const round = await getFinalRound(tournamentId, roundId);
    if (round === null) {
      res.status(404).send('Manche introuvable');
      return;
    }
    const stage = await getStage(tournamentId, round.stage_id);
    const rounds = await listStageRounds(round.stage_id);
    const position = rounds.findIndex((r) => r.id === roundId) + 1;
    const parties = await listFinalPartiesForRound(tournamentId, roundId);
    res.render('final/parties', { title: round.game_name, stage, round, position, parties, error: null });
  }),
);

// Saisie des places d'une table d'étape
finalRouter.post(
  '/parties/:partyId/results',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const partyId = Number(req.params.partyId);
    const roundId = Number(req.body.round_id);
    const partiesUrl = `/tournaments/${tournamentId}/final/rounds/${roundId}/parties`;

    const body = req.body as Record<string, unknown>;
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

    const saved = invalid ? false : await saveFinalPartyResults(tournamentId, partyId, ranks);
    if (saved) {
      res.redirect(partiesUrl);
      return;
    }

    const round = await getFinalRound(tournamentId, roundId);
    if (round === null) {
      res.redirect(`/tournaments/${tournamentId}/final`);
      return;
    }
    const stage = await getStage(tournamentId, round.stage_id);
    const rounds = await listStageRounds(round.stage_id);
    const position = rounds.findIndex((r) => r.id === roundId) + 1;
    const parties = await listFinalPartiesForRound(tournamentId, roundId);
    res.status(400).render('final/parties', {
      title: round.game_name,
      stage,
      round,
      position,
      parties,
      error: 'Indique une place (entier ≥ 1) pour chaque participant de la table.',
    });
  }),
);
