import path from 'path';

import express from 'express';

import { config } from './config/env';
import { checkDatabaseConnection } from './db/pool';
import { tournamentsRouter } from './routes/tournaments';
import { gamesRouter } from './routes/games';

const app = express();

// Moteur de templates EJS ; les vues sont à la racine du projet (../views)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// Fichiers statiques (CSS, JS front) servis depuis ../public
app.use(express.static(path.join(__dirname, '..', 'public')));

// Parsing des formulaires et des corps JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// La racine renvoie vers la liste des tournois (point d'entrée de la config)
app.get('/', (_req, res) => {
  res.redirect('/tournaments');
});

app.use('/tournaments', tournamentsRouter);
app.use('/tournaments/:tournamentId/games', gamesRouter);

// Gestion des erreurs (doit rester le dernier middleware)
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).send('Erreur interne du serveur');
});

// Démarrage : on vérifie d'abord la base, puis on écoute
async function start(): Promise<void> {
  try {
    await checkDatabaseConnection();
    console.log('Connexion MySQL OK');
  } catch (error) {
    console.error('Impossible de se connecter à MySQL :', error);
    process.exit(1);
  }

  app.listen(config.port, () => {
    console.log(`Serveur démarré sur http://localhost:${config.port}`);
  });
}

void start();
