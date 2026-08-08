# Tournoi de jeux de société

Application web de gestion d'un tournoi de jeux de société joué en **équipes de 2**,
en deux phases : une **phase de poule** (classement des équipes) puis une **phase
finale** à élimination par étapes. Un **affichage télé** public complète l'admin.

## Fonctionnalités

- **Tournois** : création, hub de configuration, clôture.
- **Jeux** : catalogue par tournoi (durée, capacité mini/maxi, solo ou équipe,
  lien règles, disponibilité poule / finale / les deux).
- **Équipes & joueurs** : équipes de 2 joueurs, couleur de pion (suggérée libre),
  contact facultatif visible **admin uniquement**. Liste triée par total de points.
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
- **Affichage télé** : écran public plein écran, rafraîchi automatiquement, montrant
  le jeu en cours, le jeu suivant et le classement des équipes (avec couleurs).

## Règles de scoring

- Barème **relatif à la taille de la table** : `points = N − (nombre de
  participants strictement mieux classés)`, avec N = nombre de participants à la
  table. Sans égalité, le 1ᵉʳ marque N, le 2ᵉ N−1, etc.
- **Ex æquo** : places identiques → mêmes points, le(s) rang(s) suivant(s) sont sautés.
- Jeu **solo** : le participant est le joueur ; le total d'une **équipe** = somme des
  points de ses 2 joueurs.
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
| Frontend | Pages server-rendered (EJS) + Alpine.js (léger)   |

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

# 3. Base de données (adapter le nom de base à DB_NAME)
mysql -u root -p -e "CREATE DATABASE tournoi CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p tournoi < db/schema.sql

# 4. Phase finale (tables additionnelles, requis pour la phase finale)
mysql -u root -p tournoi < db/final_phase.sql
```

## Lancement

```bash
npm run dev        # développement (rechargement auto via tsx)
npm run build      # compilation TypeScript -> dist/
npm start          # exécution du build (node dist/server.js)
npm run typecheck  # vérification des types sans émettre
```

Le serveur écoute sur `http://localhost:3000` (port configurable via `PORT`).
L'affichage télé d'un tournoi est accessible sur `/tournaments/:id/display/pool`.

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
- [ ] Affichage télé phase finale / écrans rotatifs
- [ ] Correctifs finale (cascade de re-qualification, bornage de la taille de départ)
