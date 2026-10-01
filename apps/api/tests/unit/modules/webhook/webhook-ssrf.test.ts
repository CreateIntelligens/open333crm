import assert from 'node:assert/strict';
import { test } from 'vitest';
import { isBlockedUrl } from '#src/modules/webhook/downstream-forwarder.js';

test('webhook-ssrf', async () => {
  assert.equal(await isBlockedUrl('http://127.0.0.1:8080/metadata'), true);
  assert.equal(await isBlockedUrl('https://127.0.0.1:8443/metadata'), true);
  assert.equal(await isBlockedUrl('https://169.254.169.254/latest/meta-data/'), true);
});
