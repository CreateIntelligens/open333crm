import assert from 'node:assert/strict';
import { isBlockedUrl } from '../modules/webhook/downstream-forwarder.js';

assert.equal(await isBlockedUrl('http://127.0.0.1:8080/metadata'), true);
assert.equal(await isBlockedUrl('https://127.0.0.1:8443/metadata'), true);
assert.equal(await isBlockedUrl('https://169.254.169.254/latest/meta-data/'), true);

console.log('webhook SSRF tests passed');
process.exit(0);
