// MCP-style tool manifest (rule 05, Layer B) generated from apps/hub/openapi.json, so the API
// document stays the single source of truth for operation names, descriptions, and input schemas.
import { readFileSync } from 'node:fs';

export const loadOpenApi = () => JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url)));

// Inlines local `#/components/...` references.
const resolve = (doc, node) => {
  if (Array.isArray(node)) return node.map((n) => resolve(doc, n));
  if (!node || typeof node !== 'object') return node;
  if (node.$ref?.startsWith('#/')) return resolve(doc, node.$ref.slice(2).split('/').reduce((o, k) => o[k], doc));
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, resolve(doc, v)]));
};

export function buildManifest(doc) {
  const tools = [];
  for (const [path, operations] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(operations)) {
      if (op.operationId === 'manifest') continue;
      const body = op.requestBody?.content?.['application/json']?.schema;
      tools.push({
        name: op.operationId,
        description: op.description,
        inputSchema: body ? resolve(doc, body) : { type: 'object', properties: {} },
        http: { method: method.toUpperCase(), path, scopes: op.security?.flatMap((s) => Object.values(s).flat()) ?? [] },
      });
    }
  }
  return { tools };
}
