// Logto webhooks (VA-08). Deliveries are signed: `logto-signature-sha-256` = hex HMAC-SHA256 of the
// raw JSON body with the hook signing key (HUB_WEBHOOK_SIGNING_KEY, written by provision).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../core/auth.js';
import { respond } from '../core/http.js';
import { requestContext } from '../core/security.js';

export const verifySignature = (signingKey, rawBody, signature) => {
  const expected = Buffer.from(createHmac('sha256', signingKey).update(rawBody).digest('hex'));
  const sent = Buffer.from(String(signature ?? ''));
  return sent.length === expected.length && timingSafeEqual(sent, expected);
};

export const webhookRoutes = ({ signingKey, onUserDeleted, log }) => ({
  'POST /webhooks/logto': async (ctx) => {
    const raw = await ctx.text();
    if (!verifySignature(signingKey, raw, ctx.req.headers['logto-signature-sha-256'])) {
      log.warn('webhook_rejected', { reason: 'bad_signature', ip: ctx.ip });
      throw new ApiError(401, 'invalid_signature', 'Webhook signature does not match');
    }
    const payload = JSON.parse(raw);
    if (payload.event !== 'User.Deleted') return respond(ctx, { ignored: payload.event });
    const sub = payload.user?.id ?? payload.params?.userId;
    if (!sub) throw new ApiError(400, 'invalid_request', 'User.Deleted payload has no user id');
    const result = await onUserDeleted({ sub, context: requestContext(ctx) });
    log.info('user_deleted', { sub, connections: result.connections });
    return respond(ctx, { sub, ...result });
  },
});
