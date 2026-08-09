import { pool } from './pool';
import { setAdminPasswordHash } from '../repositories/authRepository';
import { hashPassword } from '../utils/password';

// Définit (ou remplace) le mot de passe admin. Le mot de passe passe en argument
// ou via la variable ADMIN_PASSWORD ; seul son HACHÉ est enregistré en base.
// Usage : npm run set-admin-password -- <mot de passe>
async function run(): Promise<void> {
  const password = process.argv[2] ?? process.env.ADMIN_PASSWORD;
  if (!password) {
    console.error('Usage : npm run set-admin-password -- <mot de passe>');
    process.exit(1);
  }

  try {
    await setAdminPasswordHash(hashPassword(password));
    console.log('Mot de passe admin enregistré (haché).');
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
