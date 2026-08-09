import fs from 'fs';
import path from 'path';

import mysql from 'mysql2/promise';

import { config } from '../config/env';

// Runner de migrations : applique dans l'ordre les fichiers db/migrations/*.sql
// pas encore joués, en suivant leur état dans la table `schema_migrations`.
// Idempotent : rejouable sans risque (les migrations utilisent IF NOT EXISTS,
// et une migration déjà enregistrée est ignorée).

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'db', 'migrations');

async function run(): Promise<void> {
  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    charset: 'utf8mb4',
    multipleStatements: true, // un fichier de migration peut contenir plusieurs requêtes
  });

  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       VARCHAR(255) NOT NULL,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const [appliedRows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT name FROM schema_migrations',
    );
    const applied = new Set(appliedRows.map((r) => r.name as string));

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) {
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      process.stdout.write(`Application de ${file}... `);
      try {
        await connection.query(sql);
        await connection.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
        console.log('OK');
        count += 1;
      } catch (error) {
        console.log('ÉCHEC');
        throw new Error(`Migration ${file} en échec : ${(error as Error).message}`);
      }
    }

    console.log(
      count === 0 ? 'Base à jour : aucune migration à appliquer.' : `${count} migration(s) appliquée(s).`,
    );
  } finally {
    await connection.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
