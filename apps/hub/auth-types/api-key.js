// API key auth type (EX-03): the user enters a key; it never expires on the Hub's side.
import { HandlerError, runTestRequest } from '../core/extension.js';

export default {
  type: 'api_key',
  definitionSchema: { type: 'object', additionalProperties: false, properties: {} },
  requiredCredentialFields: ['apiKey'],
  secretFields: ['apiKey'],

  async collectCredentials(ctx, input) {
    if (!input.apiKey) throw new HandlerError('invalid_input', 'apiKey is required');
    return { kind: 'api_key', apiKey: input.apiKey };
  },

  test: (ctx, credential) => runTestRequest(ctx, credential),

  getCredentials: (ctx, credential) => ({ secret: { apiKey: credential.apiKey }, expiresAt: null }),
};
