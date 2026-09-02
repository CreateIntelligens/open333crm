import assert from 'node:assert/strict';
import { decryptCredentials, encryptCredentials } from '../modules/channel/channel.service.js';

const originalKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
delete process.env.CREDENTIAL_ENCRYPTION_KEY;
assert.throws(() => encryptCredentials({ channelAccessToken: 'secret' }), /CREDENTIAL_ENCRYPTION_KEY/);

process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-credential-encryption-key-32-bytes!!';
const encrypted = encryptCredentials({ channelAccessToken: 'secret' });
assert.deepEqual(decryptCredentials(encrypted), { channelAccessToken: 'secret' });

if (originalKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
else process.env.CREDENTIAL_ENCRYPTION_KEY = originalKey;

console.log('channel credential security tests passed');
