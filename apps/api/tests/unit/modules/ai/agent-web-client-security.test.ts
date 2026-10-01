import assert from 'node:assert/strict';
import { assertSafePublicHttpUrl } from '../modules/ai/agent/web-client.js';

assert.throws(
  () => assertSafePublicHttpUrl('http://[::ffff:169.254.169.254]/latest/meta-data/'),
  /Rejected unsafe URL target/,
);
assert.throws(
  () => assertSafePublicHttpUrl('http://[::ffff:10.0.0.1]/'),
  /Rejected unsafe URL target/,
);

console.log('agent web client security tests passed');
