import { Router } from 'express';

import { getTournament } from '../repositories/tournamentRepository';
import {
  listTeams,
  getTeam,
  createTeam,
  updateTeam,
  deleteTeam,
  suggestColor,
  TeamInput,
} from '../repositories/teamRepository';
import { asyncHandler } from '../utils/asyncHandler';

// mergeParams : rend req.params.tournamentId (du chemin de montage) accessible ici
export const teamsRouter = Router({ mergeParams: true });

// Valeurs par défaut d'un formulaire vierge (les 2 joueurs sont vides)
const emptyValues = {
  name: '',
  color: '#3366CC',
  players: [
    { pseudo: '', contact: '' },
    { pseudo: '', contact: '' },
  ],
};

// Analyse et valide le formulaire d'équipe ; renvoie l'entrée validée OU les erreurs
function parseTeamForm(body: Record<string, unknown>): { input: TeamInput | null; errors: string[] } {
  const errors: string[] = [];

  // Nom d'équipe facultatif (fallback = pseudos concaténés, calculé à l'affichage)
  const nameRaw = String(body.name ?? '').trim();
  const name = nameRaw === '' ? null : nameRaw;

  // Couleur du pion : hex #RRGGBB obligatoire
  const color = String(body.color ?? '').trim().toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(color)) {
    errors.push('La couleur doit être au format hexadécimal (#RRGGBB).');
  }

  // Les champs joueurs arrivent en tableaux : pseudo[0], pseudo[1], contact[0], contact[1]
  const pseudos = Array.isArray(body.pseudo) ? body.pseudo : [body.pseudo];
  const contacts = Array.isArray(body.contact) ? body.contact : [body.contact];

  const players: { pseudo: string; contact: string | null }[] = [];
  for (let i = 0; i < 2; i += 1) {
    const pseudo = String(pseudos[i] ?? '').trim();
    if (pseudo === '') {
      errors.push(`Le pseudo du joueur ${i + 1} est obligatoire.`);
    }
    const contactRaw = String(contacts[i] ?? '').trim();
    players.push({ pseudo, contact: contactRaw === '' ? null : contactRaw });
  }

  // Deux joueurs distincts au sein de l'équipe
  if (players[0].pseudo !== '' && players[0].pseudo === players[1].pseudo) {
    errors.push('Les deux joueurs doivent avoir des pseudos différents.');
  }

  if (errors.length > 0) {
    return { input: null, errors };
  }

  return {
    input: {
      name,
      color,
      players: [players[0], players[1]],
    },
    errors: [],
  };
}

// Middleware : charge le tournoi parent (404 sinon) et le partage aux vues via res.locals
teamsRouter.use(
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

// Liste des équipes du tournoi
teamsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const teams = await listTeams(Number(req.params.tournamentId));
    res.render('teams/list', { title: 'Équipes', teams });
  }),
);

// Formulaire de création (couleur pré-remplie avec une teinte libre)
teamsRouter.get(
  '/new',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    res.render('teams/form', {
      title: 'Nouvelle équipe',
      formAction: `/tournaments/${tournamentId}/teams`,
      values: { ...emptyValues, color: await suggestColor(tournamentId) },
      errors: [],
    });
  }),
);

// Création
teamsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const { input, errors } = parseTeamForm(req.body);
    if (input === null) {
      res.status(400).render('teams/form', {
        title: 'Nouvelle équipe',
        formAction: `/tournaments/${tournamentId}/teams`,
        values: rebuildValues(req.body),
        errors,
      });
      return;
    }
    await createTeam(tournamentId, input);
    res.redirect(`/tournaments/${tournamentId}/teams`);
  }),
);

// Formulaire d'édition
teamsRouter.get(
  '/:teamId/edit',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const team = await getTeam(tournamentId, Number(req.params.teamId));
    if (team === null) {
      res.status(404).send('Équipe introuvable');
      return;
    }
    res.render('teams/form', {
      title: "Modifier l'équipe",
      formAction: `/tournaments/${tournamentId}/teams/${team.id}`,
      values: {
        name: team.name ?? '',
        color: team.color,
        players: [
          team.players[0] ?? { pseudo: '', contact: '' },
          team.players[1] ?? { pseudo: '', contact: '' },
        ],
      },
      errors: [],
    });
  }),
);

// Mise à jour
teamsRouter.post(
  '/:teamId',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    const teamId = Number(req.params.teamId);
    const { input, errors } = parseTeamForm(req.body);
    if (input === null) {
      res.status(400).render('teams/form', {
        title: "Modifier l'équipe",
        formAction: `/tournaments/${tournamentId}/teams/${teamId}`,
        values: rebuildValues(req.body),
        errors,
      });
      return;
    }
    await updateTeam(tournamentId, teamId, input);
    res.redirect(`/tournaments/${tournamentId}/teams`);
  }),
);

// Suppression
teamsRouter.post(
  '/:teamId/delete',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    await deleteTeam(tournamentId, Number(req.params.teamId));
    res.redirect(`/tournaments/${tournamentId}/teams`);
  }),
);

// Reconstruit les valeurs du formulaire depuis le corps brut (pour réafficher après erreur)
function rebuildValues(body: Record<string, unknown>): typeof emptyValues {
  const pseudos = Array.isArray(body.pseudo) ? body.pseudo : [body.pseudo];
  const contacts = Array.isArray(body.contact) ? body.contact : [body.contact];
  return {
    name: String(body.name ?? ''),
    color: String(body.color ?? '#3366CC'),
    players: [
      { pseudo: String(pseudos[0] ?? ''), contact: String(contacts[0] ?? '') },
      { pseudo: String(pseudos[1] ?? ''), contact: String(contacts[1] ?? '') },
    ],
  };
}
