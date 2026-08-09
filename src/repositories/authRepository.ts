import { RowDataPacket } from 'mysql2';

import { pool } from '../db/pool';

// Réglage stockant le HACHÉ du mot de passe admin (jamais le mot de passe en clair).
const ADMIN_PASSWORD_KEY = 'admin_password_hash';

// Récupère le haché du mot de passe admin, ou null si non configuré.
export async function getAdminPasswordHash(): Promise<string | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT value FROM app_settings WHERE name = ? LIMIT 1',
    [ADMIN_PASSWORD_KEY],
  );
  return rows.length > 0 ? (rows[0].value as string) : null;
}

// Enregistre (ou remplace) le haché du mot de passe admin.
export async function setAdminPasswordHash(hash: string): Promise<void> {
  await pool.execute(
    `INSERT INTO app_settings (name, value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [ADMIN_PASSWORD_KEY, hash],
  );
}
