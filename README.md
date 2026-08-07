# Tournoi de jeux de société

Application web de gestion d'un tournoi de jeux de société joué en **équipes de 2**,
en deux phases : une **phase de poules** (classement des équipes) puis une **phase
finale** à élimination directe.

## Fonctionnalités

- **Admin** : gestion des jeux, des joueurs / équipes et des poules ; tirage des
  tables, saisie et correction des points, validation des résultats.
- **Saisie mobile** : les joueurs entrent le classement de leur table (soumis à
  validation de l'admin).
- **Écran d'affichage** : classement des équipes, rafraîchi manuellement.

## Règles de scoring (conception figée)

- Barème **relatif à la taille de la table** : `points = N − rang + 1` (N = nombre
  de joueurs à la table).
- Ex æquo : rang partagé, le rang suivant est sauté.
- Jeu **solo** : score d'une équipe = somme des points de ses 2 membres (tables
  tirées au sein de la poule).
- Jeu **en équipe** : l'équipe marque directement.
- Départage de poule : nombre de 1res places, puis de 2es, etc.

## Stack technique

| Couche   | Choix                                          |
|----------|------------------------------------------------|
| Langage  | TypeScript                                     |
| Backend  | Node.js + Express                              |
| Base     | MySQL 8 (accès via `mysql2`, SQL écrit à la main) |
| Frontend | Pages server-rendered + Alpine.js (léger)      |

## Prérequis

- Node.js 22+
- MySQL 8+

## Installation

```bash
# 1. Dépendances
npm install

# 2. Configuration
cp .env.example .env
# puis renseigner les identifiants MySQL dans .env

# 3. Base de données
mysql -u root -p -e "CREATE DATABASE tournoi CHARACTER SET utf8mb4;"
mysql -u root -p tournoi < db/schema.sql
```

## Lancement

> Les scripts npm (`dev`, `build`, `start`) seront ajoutés avec le lot *scaffolding*.

## Conventions

- Code (variables, fonctions, tables) en **anglais**, commentaires et doc en **français**.
- Principe **KISS** : pas de framework front, pas d'ORM, dépendances minimales.

## Roadmap

- [x] Conception métier + schéma MySQL
- [ ] Scaffolding Node/TS (serveur Express, connexion MySQL)
- [ ] Gestion des jeux
- [ ] Gestion des joueurs / équipes
- [ ] Phase de poules (tirage, saisie, classement)
- [ ] Phase finale (bracket)
