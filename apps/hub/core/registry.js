// Extension registry (EX-02): loads auth type handlers and connector definitions from directories
// at startup, validates them, and binds each connector to its handler. Core never names a
// provider; adding a connector or auth type is a new file in a directory (CN-04, EX-04).
// Invalid modules or definitions -> RegistryError listing every problem (CN-05).
import { readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { interfaceErrors } from './extension.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const readSchema = (name) => JSON.parse(readFileSync(new URL(`../schemas/${name}`, import.meta.url)));

export const DEFAULT_AUTH_TYPE_DIRS = ['apps/hub/auth-types'];
export const DEFAULT_CONNECTOR_DIRS = ['apps/hub/connectors'];

// Comma-separated env value -> absolute directories (relative entries resolve from the repo root).
export const dirsFromEnv = (value, defaults) =>
  (value ? value.split(',').map((d) => d.trim()).filter(Boolean) : defaults).map((d) => (isAbsolute(d) ? d : resolve(repoRoot, d)));

export class RegistryError extends Error {
  constructor(problems) {
    super(`Invalid Hub extensions:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.problems = problems;
  }
}

// Files loaded from a directory: no leading underscore (templates), matching extension.
const listFiles = (dir, ext) => readdirSync(dir).filter((f) => f.endsWith(ext) && !f.startsWith('_')).sort();

export async function loadRegistry({ authTypeDirs, connectorDirs, env = process.env, settings = {}, log = () => {} }) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateConnector = ajv.compile(readSchema('connector.schema.json'));
  const validateManifest = ajv.compile(readSchema('auth-type.schema.json'));
  const describe = (errors) => ajv.errorsText(errors, { dataVar: '' });
  const problems = [];

  // --- Auth type handlers ---
  const authTypes = new Map();
  for (const dir of authTypeDirs) {
    for (const file of listFiles(dir, '.js')) {
      const handler = (await import(pathToFileURL(join(dir, file)).href)).default;
      if (!handler) continue; // documentation-only modules (types.js)
      const where = `${join(dir, file)}`;
      const errors = [...(validateManifest(handler) ? [] : [describe(validateManifest.errors)]), ...interfaceErrors(handler)];
      let validateSettings;
      if (!errors.length) {
        try {
          validateSettings = ajv.compile(handler.definitionSchema);
        } catch (err) {
          errors.push(`definitionSchema does not compile: ${err.message}`);
        }
      }
      if (errors.length) problems.push(`${where}: ${errors.join('; ')}`);
      else authTypes.set(handler.type, { ...handler, validateSettings, file: where });
    }
  }

  // --- Connector definitions (later directories override earlier ones by id) ---
  const definitions = new Map();
  for (const dir of connectorDirs) {
    for (const file of listFiles(dir, '.json')) {
      const where = join(dir, file);
      let definition;
      try {
        definition = JSON.parse(readFileSync(where, 'utf8'));
      } catch (err) {
        problems.push(`${where}: invalid JSON (${err.message})`);
        continue;
      }
      if (!validateConnector(definition)) {
        problems.push(`${where}: ${describe(validateConnector.errors)}`);
        continue;
      }
      const handler = authTypes.get(definition.authType);
      if (!handler) {
        problems.push(`${where}: unknown authType "${definition.authType}" (loaded: ${[...authTypes.keys()].join(', ')})`);
        continue;
      }
      if (!handler.validateSettings(definition.settings ?? {})) {
        problems.push(`${where}: settings ${describe(handler.validateSettings.errors)}`);
        continue;
      }
      const fields = new Set((definition.credentialFields ?? []).map((f) => f.name));
      const missingFields = handler.requiredCredentialFields.filter((name) => !fields.has(name));
      if (definition.baseUrl.fromField && !fields.has(definition.baseUrl.fromField)) missingFields.push(definition.baseUrl.fromField);
      if (missingFields.length) {
        problems.push(`${where}: credentialFields must include ${missingFields.join(', ')}`);
        continue;
      }
      definitions.set(definition.id, { definition, handler, file: where });
    }
  }
  if (problems.length) throw new RegistryError(problems);

  // --- Enable (EX-05) + env (CN-02) ---
  const connectors = new Map();
  const skipped = [];
  for (const [id, entry] of definitions) {
    if (settings[id]?.enabled === false) {
      skipped.push({ id, reason: 'disabled' });
      log('connector_disabled', { id });
      continue;
    }
    const missingEnv = Object.values(entry.definition.env ?? {}).filter((name) => !env[name]);
    if (missingEnv.length) {
      skipped.push({ id, reason: 'missing_env', missingEnv });
      log('connector_skipped', { id, missingEnv });
      continue;
    }
    const client = Object.fromEntries(Object.entries(entry.definition.env ?? {}).map(([key, name]) => [key, env[name]]));
    connectors.set(id, { ...entry, client });
  }
  return { authTypes, definitions, connectors, skipped };
}
