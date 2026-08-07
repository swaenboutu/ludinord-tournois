import path from 'path';

import express from 'express';

import { config } from './config/env';
import { checkDatabaseConnection } from './db/pool';

const app = express();

// Moteur de templates EJS ; les vues sont à la racine du projet (../views)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// Fichiers statiques (CSS, JS front) servis depuis ../public
app.use(express.static(path.join(__dirname, '..', 'public')));

// Parsing des formulaires et des corps JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Page d'accueil
app.get('/', (_req, res) => {
  res.render('home', { title: 'Tournoi de jeux de société' });
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
