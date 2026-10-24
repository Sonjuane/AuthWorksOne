// Hub API caller authentication (HA-01..HA-05): bearer JWT for the Hub resource -> user (`sub`),
// calling app (`client_id`, must be registered in config), and granted scopes.

// Error with a stable API code (TV-06) and HTTP status; `details` are safe to return to callers.
export class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function createAuthenticator({ verify, clients }) {
  return async function authenticate(headers, requiredScope) {
    const match = /^Bearer\s+(\S+)$/i.exec(headers.authorization ?? '');
    if (!match) throw new ApiError(401, 'invalid_token', 'Missing bearer access token');
    let claims;
    try {
      claims = await verify(match[1]);
    } catch {
      throw new ApiError(401, 'invalid_token', 'Access token is invalid, expired, or for another audience');
    }
    // Verified claims ride on later errors (for audit) but never in the response body.
    const reject = (status, code, message) => Object.assign(new ApiError(status, code, message), { claims });
    const scopes = new Set(String(claims.scope ?? '').split(' ').filter(Boolean));
    if (!scopes.has(requiredScope)) throw reject(403, 'insufficient_scope', `Requires scope ${requiredScope}`);
    const client = clients.get(claims.client_id);
    if (!client) throw reject(403, 'client_not_registered', 'The calling application is not registered with the Hub');
    return { sub: claims.sub, clientId: claims.client_id, client, scopes, roles: claims.roles ?? [] };
  };
}
