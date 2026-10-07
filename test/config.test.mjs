import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { SCOPES } from '../web/config.js';

test('PWA token scopes match the GAS manifest', () => {
  const manifest = JSON.parse(readFileSync(new URL('../gas/appsscript.json', import.meta.url)));
  assert.deepStrictEqual(SCOPES.split(' ').sort(), [...manifest.oauthScopes].sort());
});
