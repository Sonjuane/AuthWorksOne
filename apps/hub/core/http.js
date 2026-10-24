// Response envelope shared by every Hub API response (rule 05, Layer A):
// { meta: { requestId, apiVersion }, data } or { meta, error: { code, message, ...details } }.
import { randomUUID } from 'node:crypto';
import { ApiError } from './auth.js';

const meta = () => ({ requestId: `req_${randomUUID()}`, apiVersion: '1' });

export const respond = (ctx, data, status = 200) => ctx.json({ meta: meta(), data }, status);

export const respondError = (ctx, err) =>
  ctx.json({ meta: meta(), error: { code: err.code, message: err.message, ...err.details } }, err.status);

// Security headers (NF-06); HSTS only when served over https.
export const securityHeaders = ({ https }) => ({
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  ...(https ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
});

// onError for apps/lib/web.js: ApiErrors keep their code; anything else is logged and hidden.
export const errorHandler = (log) => (err, ctx) => {
  if (err instanceof ApiError) return respondError(ctx, err);
  log.error('unhandled_error', { path: ctx.url.pathname, error: err });
  return respondError(ctx, new ApiError(500, 'internal_error', 'Internal error'));
};
