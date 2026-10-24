// Fixture auth type proving EX-04: a new auth type is one module in an auth-types directory
// (loaded via HUB_AUTH_TYPE_DIRS), with no core or existing-connector changes.
import { HandlerError, runTestRequest } from '../../../apps/hub/core/extension.js';

export default {
  type: 'static_bearer',
  definitionSchema: { type: 'object', additionalProperties: false, properties: {} },
  requiredCredentialFields: ['token'],
  secretFields: ['accessToken'],

  async collectCredentials(ctx, input) {
    if (!input.token) throw new HandlerError('invalid_input', 'token is required');
    return { kind: 'static_bearer', accessToken: input.token };
  },

  test: (ctx, credential) => runTestRequest(ctx, credential),

  getCredentials: (ctx, credential) => ({ secret: { accessToken: credential.accessToken }, expiresAt: null }),
};
