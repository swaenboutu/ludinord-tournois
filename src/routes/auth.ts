import { Router } from 'express';

import { config } from '../config/env';
import { getAdminPasswordHash } from '../repositories/authRepository';
import { verifyPassword } from '../utils/password';
import { signSession } from '../utils/session';
import { SESSION_COOKIE } from '../middleware/requireAuth';
import { asyncHandler } from '../utils/asyncHandler';

export const authRouter = Router();

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 h

// N'accepte qu'une cible interne (évite les redirections ouvertes).
function safeNext(value: unknown): string {
  const next = String(value ?? '');
  return next.startsWith('/') && !next.startsWith('//') ? next : '/tournaments';
}

// Page de connexion
authRouter.get('/login', (req, res) => {
  res.render('auth/login', {
    title: 'Connexion admin',
    error: null,
    next: safeNext(req.query.next),
  });
});

// Vérification du mot de passe
authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const password = String(req.body.password ?? '');
    const next = safeNext(req.body.next);
    const hash = await getAdminPasswordHash();

    if (hash !== null && verifyPassword(password, hash)) {
      res.cookie(SESSION_COOKIE, signSession(config.session.secret, SESSION_TTL_MS), {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: SESSION_TTL_MS,
        path: '/',
      });
      res.redirect(next);
      return;
    }

    res.status(401).render('auth/login', {
      title: 'Connexion admin',
      error:
        hash === null
          ? "Aucun mot de passe admin configuré. Lancez : npm run set-admin-password -- <mot de passe>."
          : 'Mot de passe incorrect.',
      next,
    });
  }),
);

// Déconnexion
authRouter.post('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.redirect('/login');
});
