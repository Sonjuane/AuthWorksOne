// Hub UI request guards: signed-in user (Logto session via apps/lib/oidc.js) and CSRF
// double-submit for state-changing UI calls (NF-06).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError } from './auth.js';

export const newCsrfToken = () => randomBytes(24).toString('base64url');

export function requireUser(ctx) {
  if (!ctx.session.user) throw new ApiError(401, 'login_required', 'Sign in to the Hub first');
  return ctx.session.user;
}

// The UI reads the token from GET /ui-api/session and sends it as `x-csrf-token`.
export function requireCsrf(ctx) {
  const sent = Buffer.from(String(ctx.req.headers['x-csrf-token'] ?? ''));
  const expected = Buffer.from(String(ctx.session.csrf ?? ''));
  if (!expected.length || sent.length !== expected.length || !timingSafeEqual(sent, expected)) {
    throw new ApiError(403, 'csrf_failed', 'Missing or invalid CSRF token');
  }
}

// Same-origin relative paths only (no open redirects).
export const safeReturnPath = (value, fallback = '/') =>
  typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : fallback;

// Request metadata recorded in audit entries (AU-03).
export const requestContext = (ctx) => ({ ip: ctx.ip ?? null, userAgent: ctx.req.headers['user-agent'] ?? null });
