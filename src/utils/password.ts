import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

// Hachage de mot de passe avec scrypt (intégré à Node, aucune dépendance).
// Le mot de passe en clair n'est jamais stocké : on garde "sel$empreinte" (hex).
const KEY_LENGTH = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, KEY_LENGTH).toString('hex');
  return `${salt}$${hash}`;
}

// Vérifie un mot de passe contre "sel$empreinte", en temps constant.
export function verifyPassword(plain: string, stored: string): boolean {
  const [salt, hash] = stored.split('$');
  if (!salt || !hash) {
    return false;
  }
  const computed = scryptSync(plain, salt, KEY_LENGTH);
  const expected = Buffer.from(hash, 'hex');
  if (computed.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(computed, expected);
}
