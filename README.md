# Tournoi de jeux de société

Application web de gestion d'un tournoi de jeux de société joué en **équipes**
(taille configurable par tournoi, de 1 à N joueurs), en deux phases : une **phase
de poule** (classement des équipes) puis une **phase finale** à élimination par
étapes. Un **affichage télé** public et un **espace joueur** complètent l'admin.

## Fonctionnalités

- **Accès admin protégé** : la configuration (tournois, jeux, équipes, poule,
  finale) exige une connexion par mot de passe ; les écrans **TV** et **joueur**
  restent publics. Mot de passe stocké **haché** (scrypt), jamais en clair.
- **Tournois** : création (avec le **nombre de joueurs par équipe**), hub de
  configuration, et cycle de vie **Planifié → En cours → Clôturé** (démarrer,
  clôturer, ré-ouvrir).
- **Jeux** : catalogue par tournoi (durée, capacité mini/maxi, solo ou équipe,
  lien règles, disponibilité poule / finale / les deux). **Import CSV** en lot
  (séparateur `,` ou `;`, sans en-tête).
- **Équipes & joueurs** : équipes de N joueurs (taille du tournoi), couleur de pion (suggérée libre),
  contact facultatif visible **admin uniquement**. Liste triée par total de points.
  **Import CSV** en lot (séparateur `,` ou `;`) avec page d'aide au format.
- **Phase de poule** :
  - manches ordonnées (sélection des jeux joués et de leur ordre) ;
  - tirage aléatoire des tables (coéquipiers **séparés** en solo, équipe **groupée**
    en jeu d'équipe ; tables équilibrées selon la capacité) ;
  - saisie des places par table → calcul des points ; classement de poule.
- **Phase finale** (élimination par étapes) :
  - taille de départ au choix (2/4/8/16/32), étapes générées par division ;
  - qualification depuis le classement de poule ;
  - chaque étape se joue comme une poule ; la moitié passe à l'étape suivante,
    égalité départagée par le rang de poule (*seed*).
- **Affichage télé** : écrans publics plein écran (thème LudiNord), rafraîchis
  automatiquement — écran **poule** (jeu en cours, jeu suivant, classement avec
  défilement auto), écran **phases finales** en arbre (des premières étapes
  jusqu'à la demi-finale) et écran **finale** (grille jeux × équipes : points par
  jeu, total, meneur mis en avant).
- **Espace joueur** : interface publique (mobile) où un joueur s'identifie par son
  pseudo ou le nom de son équipe (mémorisé en local) et suit sa partie/jeu en cours
  (avec lien de règles si renseigné), le total de son équipe et les scores de chacun.

## Règles de scoring

- Barème **relatif à la taille de la table** : `points = N − (nombre de
  participants strictement mieux classés)`, avec N = nombre de participants à la
  table. Sans égalité, le 1ᵉʳ marque N, le 2ᵉ N−1, etc.
- **Ex æquo** : places identiques → mêmes points, le(s) rang(s) suivant(s) sont sautés.
- Jeu **solo** : le participant est le joueur ; le total d'une **équipe** = somme des
  points de ses joueurs.
- Jeu **en équipe** : le participant est l'équipe, qui marque directement.
- **Poule** : classement par total de points décroissant.
- **Finale** : points remis à zéro à chaque étape ; à égalité sur la ligne de
  qualification, c'est le classement de poule qui départage.

## Stack technique

| Couche   | Choix                                             |
|----------|---------------------------------------------------|
| Langage  | TypeScript                                        |
| Backend  | Node.js + Express                                 |
| Base     | MySQL 8 (accès via `mysql2`, SQL écrit à la main) |
| Frontend | Pages server-rendered (EJS) + JS vanilla minimal    |

## Prérequis

- Node.js 22+
- MySQL 8+

## Installation

```bash
# 1. Dépendances
npm install

# 2. Configuration
cp .env.example .env
# puis renseigner les identifiants MySQL dans .env (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME…)

# 3. Base de données : créer la base vide (adapter le nom à DB_NAME)
mysql -u root -p -e "CREATE DATABASE tournoi CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 4. Migrations : crée / met à jour le schéma
npm run migrate

# 5. Mot de passe admin (obligatoire pour accéder à la configuration)
npm run set-admin-password -- "mon-mot-de-passe"
```

> **Migrations** : les fichiers `db/migrations/*.sql` (numérotés) sont appliqués dans
> l'ordre par `npm run migrate`, qui suit leur état dans la table `schema_migrations`.
> La commande est **idempotente** et sûre sur base neuve comme existante — relance-la
> après un `git pull` pour appliquer les nouvelles migrations.

## Lancement

```bash
npm run migrate    # applique les migrations de base de données
npm run set-admin-password -- "xxx"  # définit/replace le mot de passe admin (haché)
npm run dev        # développement (rechargement auto via tsx)
npm run build      # compilation TypeScript -> dist/
npm start          # exécution du build (node dist/server.js)
npm run typecheck  # vérification des types sans émettre
```

Le serveur écoute sur `http://localhost:3000` (port configurable via `PORT`).
L'affichage télé d'un tournoi est accessible sur `/tournaments/:id/display/pool`.
Sonde de santé : `GET /health` (200 si la base répond, 503 sinon). Le serveur
s'arrête proprement sur SIGINT/SIGTERM (fermeture du pool MySQL).

## Authentification admin

La configuration (tournois, jeux, équipes, poule, finale) est protégée par un mot
de passe unique. Les écrans **TV** (`/display/...`) et **joueur** (`/player/...`)
restent publics.

**Définir ou changer le mot de passe** (la table `app_settings` doit exister →
lance `npm run migrate` au préalable) :

```bash
npm run set-admin-password -- "mon-mot-de-passe"
```

- Le `--` est indispensable : il transmet le mot de passe au script (sinon npm
  l'interprète comme une option). Sous PowerShell : `npm run set-admin-password -- "xxx"`.
- Alternative sans exposer le mot de passe dans l'historique du shell :
  `ADMIN_PASSWORD="xxx" npm run set-admin-password`.
- Seul le **haché scrypt** est stocké (`sel$empreinte`), jamais le mot de passe en clair.
- Aucune longueur minimale imposée.

**Se connecter** : ouvre `/login`, saisis le mot de passe. La session est un cookie
signé (12 h). Bouton **Déconnexion** en haut des pages admin.

**Sessions persistantes** : définis `SESSION_SECRET` dans `.env` (chaîne aléatoire
longue). Sans lui, un secret est généré à chaque démarrage → les admins sont
déconnectés à chaque redémarrage.

## Conventions

- Code (variables, fonctions, tables) en **anglais**, commentaires et doc en **français**.
- Principe **KISS** : pas de framework front, pas d'ORM, dépendances minimales.

## Roadmap

- [x] Conception métier + schéma MySQL
- [x] Scaffolding Node/TS (serveur Express, connexion MySQL)
- [x] Gestion des jeux
- [x] Gestion des joueurs / équipes
- [x] Phase de poule (tirage, saisie, classement)
- [x] Phase finale (élimination par étapes)
- [x] Affichage télé (écran phase de poule)
- [x] Affichage télé phase finale (arbre jusqu'à la demi-finale)
- [x] Écran télé dédié à la finale (grille jeux × équipes)
- [x] Espace joueur (identification, partie/jeu en cours, scores)
- [x] Authentification admin (mot de passe haché, écrans publics épargnés)
- [ ] Correctifs finale (cascade de re-qualification, bornage de la taille de départ)
