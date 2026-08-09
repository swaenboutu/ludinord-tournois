import path from 'path';

import express from 'express';

import { config } from './config/env';
import { pool, checkDatabaseConnection } from './db/pool';
import { tournamentsRouter } from './routes/tournaments';
import { gamesRouter } from './routes/games';
import { teamsRouter } from './routes/teams';
import { poolRouter } from './routes/pool';
import { finalRouter } from './routes/final';
import { displayRouter } from './routes/display';
import { playerRouter } from './routes/player';
import { authRouter } from './routes/auth';

const app = express();

// Moteur de templates EJS ; les vues sont à la racine du projet (../views)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// Fichiers statiques (CSS, JS front) servis depuis ../public
app.use(express.static(path.join(__dirname, '..', 'public')));

// Parsing des formulaires et des corps JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Sonde de santé : 200 si la base répond, 503 sinon (pour supervision/déploiement)
app.get('/health', (_req, res) => {
  checkDatabaseConnection()
    .then(() => res.json({ status: 'ok' }))
    .catch(() => res.status(503).json({ status: 'error' }));
});

// Authentification admin (login / logout), publique
app.use(authRouter);

// La racine renvoie vers la liste des tournois (point d'entrée de la config)
app.get('/', (_req, res) => {
  res.redirect('/tournaments');
});

app.use('/tournaments', tournamentsRouter);
app.use('/tournaments/:tournamentId/games', gamesRouter);
app.use('/tournaments/:tournamentId/teams', teamsRouter);
app.use('/tournaments/:tournamentId/pool', poolRouter);
app.use('/tournaments/:tournamentId/final', finalRouter);
app.use('/tournaments/:tournamentId/display', displayRouter);
app.use('/tournaments/:tournamentId/player', playerRouter);

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

  const server = app.listen(config.port, () => {
    console.log(`Serveur démarré sur http://localhost:${config.port}`);
  });

  // Arrêt propre : on cesse d'accepter des requêtes, puis on ferme le pool MySQL.
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`\n${signal} reçu, arrêt en cours...`);
    server.close(() => {
      pool
        .end()
        .then(() => {
          console.log('Arrêt propre terminé.');
          process.exit(0);
        })
        .catch((error) => {
          console.error('Erreur à la fermeture du pool MySQL :', error);
          process.exit(1);
        });
    });
    // Filet de sécurité si la fermeture traîne (connexions bloquées)
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void start();
