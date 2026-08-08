import { Router } from 'express';

import {
  listTeams,
  getTeam,
  createTeam,
  createTeams,
  updateTeam,
  deleteTeam,
  deleteAllTeams,
  suggestColor,
  TeamInput,
  BulkTeamInput,
} from '../repositories/teamRepository';
import { parseCsv, detectDelimiter } from '../utils/csv';
import { handleCsvImport, renderImportForm, CsvImportConfig } from '../utils/csvImport';
import { getTeamStanding } from '../repositories/standingsRepository';
import { loadTournament } from '../middleware/loadTournament';
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

// Charge le tournoi parent (404 sinon) et le partage aux vues
teamsRouter.use(loadTournament);

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
      standing: null,
    });
  }),
);

// Config d'import CSV des équipes (parse + création), mutualisée avec le helper générique
function teamsImportConfig(tournamentId: number): CsvImportConfig<BulkTeamInput> {
  return {
    view: 'teams/import',
    title: 'Importer des équipes (CSV)',
    emptyMessage: 'Aucune équipe à importer.',
    parse: parseTeamsCsv,
    create: (inputs) => createTeams(tournamentId, inputs),
  };
}

// Page d'import CSV (définie avant les routes ':teamId' pour ne pas être capturée)
teamsRouter.get(
  '/import',
  asyncHandler(async (req, res) => {
    renderImportForm(res, teamsImportConfig(Number(req.params.tournamentId)));
  }),
);

// Traitement de l'import CSV (tout ou rien : on n'importe que si aucune erreur)
teamsRouter.post(
  '/import',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    await handleCsvImport(res, String(req.body.csv ?? ''), teamsImportConfig(tournamentId));
  }),
);

// Vide la liste des équipes (et leurs joueurs) — avant les routes ':teamId'
teamsRouter.post(
  '/clear',
  asyncHandler(async (req, res) => {
    const tournamentId = Number(req.params.tournamentId);
    await deleteAllTeams(tournamentId);
    res.redirect(`/tournaments/${tournamentId}/teams`);
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
        standing: null,
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
    const standing = await getTeamStanding(tournamentId, team.id);
    res.render('teams/form', {
      title: "Modifier l'équipe",
      formAction: `/tournaments/${tournamentId}/teams/${team.id}`,
      standing,
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
        standing: null,
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

// Mots-clés reconnaissant une ligne d'en-tête (alors ignorée à l'import)
const CSV_HEADER_TOKENS = [
  'pseudo',
  'equipe',
  'équipe',
  'team',
  'joueur',
  'contact',
  'couleur',
  'color',
  'nom',
  'name',
];

// Analyse un CSV d'équipes en entrées prêtes pour createTeams, avec les erreurs par ligne.
// Colonnes attendues : nom_equipe, pseudo_1, contact_1, pseudo_2, contact_2, couleur
function parseTeamsCsv(text: string): { inputs: BulkTeamInput[]; errors: string[] } {
  const errors: string[] = [];
  const inputs: BulkTeamInput[] = [];

  if (text.trim() === '') {
    return { inputs, errors };
  }

  const rows = parseCsv(text, detectDelimiter(text)).filter((r) =>
    r.some((f) => f.trim() !== ''),
  );
  if (rows.length === 0) {
    return { inputs, errors };
  }

  // Ignore une éventuelle ligne d'en-tête
  const first = rows[0].map((f) => f.trim().toLowerCase());
  const hasHeader = first.some((f) => CSV_HEADER_TOKENS.includes(f));
  const dataRows = hasHeader ? rows.slice(1) : rows;

  dataRows.forEach((row, index) => {
    const lineNumber = hasHeader ? index + 2 : index + 1; // n° de ligne dans le fichier
    const name = (row[0] ?? '').trim();
    const pseudo1 = (row[1] ?? '').trim();
    const contact1 = (row[2] ?? '').trim();
    const pseudo2 = (row[3] ?? '').trim();
    const contact2 = (row[4] ?? '').trim();
    const colorRaw = (row[5] ?? '').trim();

    const rowErrors: string[] = [];
    if (pseudo1 === '') {
      rowErrors.push('pseudo du joueur 1 manquant');
    }
    if (pseudo2 === '') {
      rowErrors.push('pseudo du joueur 2 manquant');
    }
    if (pseudo1 !== '' && pseudo1 === pseudo2) {
      rowErrors.push('les deux pseudos sont identiques');
    }

    let color: string | null = null;
    if (colorRaw !== '') {
      if (!/^#[0-9A-Fa-f]{6}$/.test(colorRaw)) {
        rowErrors.push('couleur invalide (attendu #RRGGBB)');
      } else {
        color = colorRaw.toUpperCase();
      }
    }

    if (rowErrors.length > 0) {
      errors.push(`Ligne ${lineNumber} : ${rowErrors.join(', ')}.`);
      return;
    }

    inputs.push({
      name: name === '' ? null : name,
      color,
      players: [
        { pseudo: pseudo1, contact: contact1 === '' ? null : contact1 },
        { pseudo: pseudo2, contact: contact2 === '' ? null : contact2 },
      ],
    });
  });

  return { inputs, errors };
}

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
