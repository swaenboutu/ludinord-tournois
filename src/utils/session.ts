import { createHmac, timingSafeEqual } from 'crypto';

// Session admin via cookie signé (HMAC-SHA256), sans dépendance externe.
// Valeur : "<expiration_ms>.<signature>". La signature couvre l'expiration,
// donc le cookie n'est pas falsifiable sans le secret serveur.

function sign(secret: string, expiry: number): string {
  return createHmac('sha256', secret).update(`admin.${expiry}`).digest('hex');
}

// Fabrique une valeur de cookie valable `ttlMs` millisecondes.
export function signSession(secret: string, ttlMs: number): string {
  const expiry = Date.now() + ttlMs;
  return `${expiry}.${sign(secret, expiry)}`;
}

// Vérifie signature + expiration d'une valeur de cookie.
export function verifySession(secret: string, value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const separator = value.lastIndexOf('.');
  if (separator === -1) {
    return false;
  }
  const expiry = Number(value.slice(0, separator));
  const signature = value.slice(separator + 1);
  if (!Number.isFinite(expiry) || expiry < Date.now()) {
    return false;
  }
  const expected = sign(secret, expiry);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
