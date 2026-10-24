// Shared access-token verifier for the Hub and internal apps (HA-01, IA-02): Logto JWT access
// tokens (`at+jwt`) checked against the issuer JWKS for signature, issuer, audience, and expiry.
import { createRemoteJWKSet, jwtVerify } from 'jose';

// `jwksUri` may differ from `${issuer}/jwks` when the app reaches Logto on an internal address.
export function createVerifier({ issuer, audience, jwksUri = `${issuer}/jwks`, keySet }) {
  const keys = keySet ?? createRemoteJWKSet(new URL(jwksUri));
  return async (token) => (await jwtVerify(token, keys, { issuer, audience, typ: 'at+jwt' })).payload;
}
