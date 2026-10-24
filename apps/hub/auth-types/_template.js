// Template auth type handler (EX-07). Copy to <type>.js (no leading underscore), rename `type`,
// implement either authorize + handleCallback (redirect flows) or collectCredentials (user-entered
// secrets), then run `npm run test:contract`. Guide: docs/03-hub-extensions.md.
import { HandlerError, runTestRequest } from '../core/extension.js';

export default {
  type: 'template_token',
  // JSON Schema for the connector's `settings`.
  definitionSchema: { type: 'object', additionalProperties: false, properties: {} },
  // credentialFields every connector of this type must declare.
  requiredCredentialFields: ['token'],
  // Keys getCredentials() returns in `secret` (OpenAPI Credential.secret lists the allowed names).
  secretFields: ['accessToken'],

  async collectCredentials(ctx, input) {
    if (!input.token) throw new HandlerError('invalid_input', 'token is required');
    return { kind: 'template_token', accessToken: input.token };
  },

  // Optional: refresh(ctx, credential) -> Credential; revoke(ctx, credential) -> void (idempotent).

  test: (ctx, credential) => runTestRequest(ctx, credential),

  getCredentials: (ctx, credential) => ({ secret: { accessToken: credential.accessToken }, expiresAt: null }),
};
