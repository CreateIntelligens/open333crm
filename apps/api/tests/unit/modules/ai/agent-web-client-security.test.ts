import assert from 'node:assert/strict';
import { test } from 'vitest';
import { assertSafePublicHttpUrl } from '#src/modules/ai/agent/web-client.js';

test('agent-web-client-security', async () => {
  assert.throws(
    () => assertSafePublicHttpUrl('http://[::ffff:169.254.169.254]/latest/meta-data/'),
    /Rejected unsafe URL target/,
  );
  assert.throws(
    () => assertSafePublicHttpUrl('http://[::ffff:10.0.0.1]/'),
    /Rejected unsafe URL target/,
  );
});
