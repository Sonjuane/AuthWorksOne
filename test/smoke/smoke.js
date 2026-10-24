// Live smoke check (build plan 8.3, CN-03): against the real provider, run the connector's own
// credential test request, then fetch one record from the reference app's record path. Skips when
// any SMOKE_<ID>_* variable is unset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render, resolveBaseUrl, runTestRequest, templateVars } from '../../apps/hub/core/extension.js';
import { createHttpClient } from '../../apps/hub/core/http-client.js';

const repo = new URL('../../', import.meta.url);
const RECORD_PATHS = JSON.parse(readFileSync(new URL('apps/sample-rp/record-paths.json', repo)));

// `credential(env)` -> { accessToken } | { username, password }, plus `input` for baseUrl.fromField.
export function smoke(id, envNames, credential) {
  test(`${id}: credential test + one record (live)`, async (t) => {
    const missing = envNames.filter((name) => !process.env[name]);
    if (missing.length) return t.skip(`set ${missing.join(', ')}`);
    const definition = JSON.parse(readFileSync(new URL(`apps/hub/connectors/${id}.json`, repo)));
    const { input, ...secret } = credential(process.env);
    const baseUrl = resolveBaseUrl(definition, input);
    const http = createHttpClient();

    const result = await runTestRequest({ connector: definition, baseUrl, http }, secret);
    assert.ok(result.ok, `credential test request -> ${result.status}`);

    const res = await http(`${baseUrl}${RECORD_PATHS[id]}`, {
      headers: { accept: 'application/json', [definition.auth.header]: render(definition.auth.format, templateVars(secret)) },
    });
    assert.equal(res.status, 200, `record request -> ${res.status}`);
    assert.ok(await res.json());
  });
}
