import { Router } from 'express';

import {
  listGames,
  getGame,
  createGame,
  createGames,
  updateGame,
  deleteGame,
  deleteAllGames,
  GameInput,
  GameAvailability,
} from '../repositories/gameRepository';
import { parseCsv, detectDelimiter } from '../utils/csv';
import { handleCsvImport, renderImportForm, CsvImportConfig } from '../utils/csvImport';
import { loadTournament } from '../middleware/loadTournament';
import { requireAuth } from '../middleware/requireAuth';
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

// Réservé à l'admin, puis charge le tournoi parent (404 sinon)
gamesRouter.use(requireAuth);
gamesRouter.use(loadTournament);

// Liste des jeux du tournoi
gamesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const games = await listGames(Number(req.params.tournamentId));
    res.render('games/list', { title: 'Jeux', games });
  }),
);

// Formulaire de création
gamesRouter.get(
  '/new',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    res.render('games/form', {
      title: 'Nouveau jeu',
      formAction: `/tournaments/${tournamentId}/games`,
      values: emptyValues,
      errors: [],
    });
  }),
);

// Config d'import CSV des jeux (parse + création), mutualisée avec le helper générique
function gamesImportConfig(tournamentId: number): CsvImportConfig<GameInput> {
  return {
    view: 'games/import',
    title: 'Importer des jeux (CSV)',
    emptyMessage: 'Aucun jeu à importer.',
    parse: parseGamesCsv,
    create: (inputs) => createGames(tournamentId, inputs),
  };
}

// Page d'import CSV (définie avant les routes ':gameId' pour ne pas être capturée)
gamesRouter.get(
  '/import',
  asyncHandler(async (req, res) => {
    renderImportForm(res, gamesImportConfig(Number(req.params.tournamentId)));
  }),
);

// Traitement de l'import CSV (tout ou rien : on n'importe que si aucune erreur)
gamesRouter.post(
  '/import',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    await handleCsvImport(res, String(req.body.csv ?? ''), gamesImportConfig(tournamentId));
  }),
);

// Vide la liste des jeux — avant les routes ':gameId'
gamesRouter.post(
  '/clear',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    await deleteAllGames(tournamentId);
    res.redirect(`/tournaments/${tournamentId}/games`);
  }),
);

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
      title: `Modifier le jeu « ${game.name} »`,
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
      const submittedName = String(req.body.name ?? '').trim();
      res.status(400).render('games/form', {
        title: submittedName !== '' ? `Modifier le jeu « ${submittedName} »` : 'Modifier le jeu',
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

// Analyse un CSV de jeux en entrées prêtes pour createGames, avec les erreurs par ligne.
// Colonnes : nom, duree_min, joueurs_min, joueurs_max, jeu_en_equipe, lien_regles, disponibilite
function parseGamesCsv(text: string): { inputs: GameInput[]; errors: string[] } {
  const errors: string[] = [];
  const inputs: GameInput[] = [];

  if (text.trim() === '') {
    return { inputs, errors };
  }

  const rows = parseCsv(text, detectDelimiter(text)).filter((r) => r.some((f) => f.trim() !== ''));

  const truthy = ['1', 'oui', 'o', 'yes', 'y', 'true', 'vrai', 'equipe', 'équipe', 'team'];
  const falsy = ['', '0', 'non', 'n', 'no', 'false', 'faux', 'solo'];
  const availabilityMap: Record<string, GameAvailability> = {
    '': 'both',
    both: 'both',
    'les deux': 'both',
    'poule+finale': 'both',
    'poule + finale': 'both',
    pool: 'pool',
    poule: 'pool',
    final: 'final',
    finale: 'final',
  };

  rows.forEach((row, index) => {
    const lineNumber = index + 1;
    const name = (row[0] ?? '').trim();
    const durationRaw = (row[1] ?? '').trim();
    const minRaw = (row[2] ?? '').trim();
    const maxRaw = (row[3] ?? '').trim();
    const teamRaw = (row[4] ?? '').trim().toLowerCase();
    const rulesRaw = (row[5] ?? '').trim();
    const availabilityRaw = (row[6] ?? '').trim().toLowerCase();

    const rowErrors: string[] = [];

    if (name === '') {
      rowErrors.push('nom manquant');
    }

    const minPlayers = Number(minRaw);
    const maxPlayers = Number(maxRaw);
    if (minRaw === '' || !Number.isInteger(minPlayers) || minPlayers < 1) {
      rowErrors.push('joueurs min invalide (entier ≥ 1)');
    }
    if (maxRaw === '' || !Number.isInteger(maxPlayers) || maxPlayers < 1) {
      rowErrors.push('joueurs max invalide (entier ≥ 1)');
    }
    if (
      Number.isInteger(minPlayers) &&
      Number.isInteger(maxPlayers) &&
      maxPlayers < minPlayers
    ) {
      rowErrors.push('joueurs max inférieur au min');
    }

    let durationMin: number | null = null;
    if (durationRaw !== '') {
      const parsed = Number(durationRaw);
      if (!Number.isInteger(parsed) || parsed < 0) {
        rowErrors.push('durée invalide (entier ≥ 0 ou vide)');
      } else {
        durationMin = parsed;
      }
    }

    let isTeamGame = false;
    if (truthy.includes(teamRaw)) {
      isTeamGame = true;
    } else if (!falsy.includes(teamRaw)) {
      rowErrors.push('jeu en équipe : valeur non reconnue (oui/non)');
    }

    // Lien des règles forcé en minuscules à l'import
    const rulesUrl = rulesRaw === '' ? null : rulesRaw.toLowerCase();
    if (rulesUrl !== null && !/^https?:\/\//i.test(rulesUrl)) {
      rowErrors.push('lien règles : doit commencer par http:// ou https://');
    }

    let availability: GameAvailability = 'both';
    if (availabilityRaw in availabilityMap) {
      availability = availabilityMap[availabilityRaw];
    } else {
      rowErrors.push('disponibilité non reconnue (poule / finale / both)');
    }

    if (rowErrors.length > 0) {
      errors.push(`Ligne ${lineNumber} : ${rowErrors.join(', ')}.`);
      return;
    }

    inputs.push({
      name,
      duration_min: durationMin,
      min_players: minPlayers,
      max_players: maxPlayers,
      is_team_game: isTeamGame,
      rules_url: rulesUrl,
      availability,
    });
  });

  return { inputs, errors };
}
