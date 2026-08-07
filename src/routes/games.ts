import { Router } from 'express';

import { getTournament } from '../repositories/tournamentRepository';
import {
  listGames,
  getGame,
  createGame,
  updateGame,
  deleteGame,
  GameInput,
  GameAvailability,
} from '../repositories/gameRepository';
import { asyncHandler } from '../utils/asyncHandler';

// mergeParams : rend req.params.tournamentId (du chemin de montage) accessible ici
export const gamesRouter = Router({ mergeParams: true });

// Valeurs par défaut d'un formulaire vierge
const emptyValues = {
  name: '',
  duration_min: '',
  min_players: '',
  max_players: '',
  is_team_game: false,
  rules_url: '',
  availability: 'both',
};

// Analyse et valide le formulaire de jeu ; renvoie l'entrée validée OU la liste des erreurs
function parseGameForm(body: Record<string, unknown>): { input: GameInput | null; errors: string[] } {
  const errors: string[] = [];

  const name = String(body.name ?? '').trim();
  if (name === '') {
    errors.push('Le nom est obligatoire.');
  }

  const minPlayers = Number(body.min_players);
  const maxPlayers = Number(body.max_players);
  if (!Number.isInteger(minPlayers) || minPlayers < 1) {
    errors.push('Le nombre minimum de joueurs doit être un entier supérieur ou égal à 1.');
  }
  if (!Number.isInteger(maxPlayers) || maxPlayers < 1) {
    errors.push('Le nombre maximum de joueurs doit être un entier supérieur ou égal à 1.');
  }
  if (Number.isInteger(minPlayers) && Number.isInteger(maxPlayers) && maxPlayers < minPlayers) {
    errors.push('Le maximum de joueurs doit être supérieur ou égal au minimum.');
  }

  // Durée facultative : vide -> null, sinon entier positif
  let durationMin: number | null = null;
  const durationRaw = String(body.duration_min ?? '').trim();
  if (durationRaw !== '') {
    const parsed = Number(durationRaw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      errors.push('La durée doit être un entier positif, ou laissée vide.');
    } else {
      durationMin = parsed;
    }
  }

  // Lien facultatif ; on n'accepte que http(s) pour éviter les URL piégées
  const rulesRaw = String(body.rules_url ?? '').trim();
  const rulesUrl = rulesRaw === '' ? null : rulesRaw;
  if (rulesUrl !== null && !/^https?:\/\//i.test(rulesUrl)) {
    errors.push('Le lien vers les règles doit commencer par http:// ou https://.');
  }

  const allowed = ['pool', 'final', 'both'];
  const availabilityRaw = String(body.availability ?? '');
  const availability: GameAvailability = allowed.includes(availabilityRaw)
    ? (availabilityRaw as GameAvailability)
    : 'both';

  // Case à cocher : présente ('on') uniquement si cochée
  const isTeamGame = body.is_team_game === 'on';

  if (errors.length > 0) {
    return { input: null, errors };
  }

  return {
    input: {
      name,
      duration_min: durationMin,
      min_players: minPlayers,
      max_players: maxPlayers,
      is_team_game: isTeamGame,
      rules_url: rulesUrl,
      availability,
    },
    errors: [],
  };
}

// Middleware : charge le tournoi parent (404 sinon) et le partage aux vues via res.locals
gamesRouter.use(
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

// Liste des jeux du tournoi
gamesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const games = await listGames(Number(req.params.tournamentId));
    res.render('games/list', { title: 'Jeux', games });
  }),
);

// Formulaire de création
gamesRouter.get('/new', (req, res) => {
  const tournamentId = Number(req.params.tournamentId);
  res.render('games/form', {
    title: 'Nouveau jeu',
    formAction: `/tournaments/${tournamentId}/games`,
    values: emptyValues,
    errors: [],
  });
});

// Création
gamesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const { input, errors } = parseGameForm(req.body);
    if (input === null) {
      res.status(400).render('games/form', {
        title: 'Nouveau jeu',
        formAction: `/tournaments/${tournamentId}/games`,
        values: req.body,
        errors,
      });
      return;
    }
    await createGame(tournamentId, input);
    res.redirect(`/tournaments/${tournamentId}/games`);
  }),
);

// Formulaire d'édition
gamesRouter.get(
  '/:gameId/edit',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const game = await getGame(tournamentId, Number(req.params.gameId));
    if (game === null) {
      res.status(404).send('Jeu introuvable');
      return;
    }
    res.render('games/form', {
      title: 'Modifier le jeu',
      formAction: `/tournaments/${tournamentId}/games/${game.id}`,
      values: game,
      errors: [],
    });
  }),
);

// Mise à jour
gamesRouter.post(
  '/:gameId',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const gameId = Number(req.params.gameId);
    const { input, errors } = parseGameForm(req.body);
    if (input === null) {
      res.status(400).render('games/form', {
        title: 'Modifier le jeu',
        formAction: `/tournaments/${tournamentId}/games/${gameId}`,
        values: req.body,
        errors,
      });
      return;
    }
    await updateGame(tournamentId, gameId, input);
    res.redirect(`/tournaments/${tournamentId}/games`);
  }),
);

// Suppression
gamesRouter.post(
  '/:gameId/delete',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    await deleteGame(tournamentId, Number(req.params.gameId));
    res.redirect(`/tournaments/${tournamentId}/games`);
  }),
);
