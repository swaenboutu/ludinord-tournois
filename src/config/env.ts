import dotenv from 'dotenv';

// Charge les variables du fichier .env dans process.env
dotenv.config();

// Récupère une variable d'environnement obligatoire, lève une erreur explicite si absente
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }
  return value;
}

// Configuration applicative typée, dérivée de l'environnement
export const config = {
  port: Number(process.env.PORT ?? 3000),
  db: {
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 3306),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    database: required('DB_NAME'),
  },
} as const;
