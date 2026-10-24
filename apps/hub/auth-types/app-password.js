// Username + application password auth type (EX-03), e.g. self-hosted WordPress (HTTP Basic).
import { HandlerError, runTestRequest } from '../core/extension.js';

export default {
  type: 'app_password',
  definitionSchema: { type: 'object', additionalProperties: false, properties: {} },
  requiredCredentialFields: ['username', 'appPassword'],
  secretFields: ['username', 'appPassword'],

  async collectCredentials(ctx, input) {
    if (!input.username || !input.appPassword) throw new HandlerError('invalid_input', 'username and appPassword are required');
    // WordPress shows application passwords with spaces; they are not part of the secret.
    return { kind: 'app_password', username: input.username, password: input.appPassword.replace(/\s+/g, '') };
  },

  test: (ctx, credential) => runTestRequest(ctx, credential),

  getCredentials: (ctx, credential) => ({ secret: { username: credential.username, appPassword: credential.password }, expiresAt: null }),
};
