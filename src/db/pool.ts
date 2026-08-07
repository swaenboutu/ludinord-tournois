import mysql from 'mysql2/promise';

import { config } from '../config/env';

// Pool de connexions MySQL partagé par toute l'application
export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
});

// Vérifie que la base est joignable (appelé au démarrage du serveur)
export async function checkDatabaseConnection(): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.ping();
  } finally {
    connection.release();
  }
}
