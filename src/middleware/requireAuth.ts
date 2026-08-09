import { RequestHandler } from 'express';

import { config } from '../config/env';
import { verifySession } from '../utils/session';

// Nom du cookie de session admin.
export const SESSION_COOKIE = 'admin_session';

// Lit un cookie depuis l'en-tête brut (évite une dépendance cookie-parser).
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      continue;
    }
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

// Protège les routes admin : laisse passer si la session est valide, sinon
// redirige vers /login en mémorisant la cible.
export const requireAuth: RequestHandler = (req, res, next) => {
  const token = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (verifySession(config.session.secret, token)) {
    next();
    return;
  }
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
};
