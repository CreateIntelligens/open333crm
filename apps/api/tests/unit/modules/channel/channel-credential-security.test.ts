/**
 * API 加解密渠道憑證只用 CREDENTIAL_ENCRYPTION_KEY（主規格 credential-encryption，AUDIT SEC-01）。
 * Workers 端見 apps/workers/tests/unit/lib/credentials.test.ts。
 */
import assert from 'node:assert/strict';
import { createDecipheriv, scryptSync } from 'node:crypto';
import { afterEach, test } from 'vitest';
import { parseEnvConfig } from '#src/config/env.js';
import { decryptCredentials, encryptCredentials } from '#src/modules/channel/channel.service.js';

const KEY = 'test-credential-encryption-key-32-bytes!!';
const originalKey = process.env.CREDENTIAL_ENCRYPTION_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  else process.env.CREDENTIAL_ENCRYPTION_KEY = originalKey;
});

test('API 啟動時缺少金鑰：環境變數驗證失敗並指出 CREDENTIAL_ENCRYPTION_KEY', () => {
  const env = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/open333',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'test-jwt-secret-12345',
    CREDENTIAL_ENCRYPTION_KEY: KEY,
  };
  assert.equal(parseEnvConfig(env).CREDENTIAL_ENCRYPTION_KEY, KEY);
  assert.throws(() => parseEnvConfig({ ...env, CREDENTIAL_ENCRYPTION_KEY: undefined }), /CREDENTIAL_ENCRYPTION_KEY/);
  assert.throws(() => parseEnvConfig({ ...env, CREDENTIAL_ENCRYPTION_KEY: 'too-short' }), /CREDENTIAL_ENCRYPTION_KEY/);
});

test('API 加密時金鑰缺少或太短：拋出錯誤', () => {
  delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  assert.throws(() => encryptCredentials({ channelAccessToken: 'secret' }), /CREDENTIAL_ENCRYPTION_KEY must be set to at least 32 characters/);
  process.env.CREDENTIAL_ENCRYPTION_KEY = 'too-short';
  assert.throws(() => encryptCredentials({ channelAccessToken: 'secret' }), /CREDENTIAL_ENCRYPTION_KEY must be set to at least 32 characters/);
});

/** 與 Workers 的 decryptCredentials()（apps/workers/src/lib/credentials.ts）相同的做法 */
function decryptLikeWorkers(encrypted: string, secret: string): unknown {
  const key = scryptSync(secret, 'open333crm-credentials', 32);
  const [ivHex, authTagHex, data] = encrypted.split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex!, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex!, 'hex'));
  return JSON.parse(decipher.update(data!, 'hex', 'utf8') + decipher.final('utf8'));
}

test('有金鑰時加密後可以還原：API 與 Workers 都能解密', () => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = KEY;
  const encrypted = encryptCredentials({ channelAccessToken: 'secret' });
  assert.deepEqual(decryptCredentials(encrypted), { channelAccessToken: 'secret' });
  assert.deepEqual(decryptLikeWorkers(encrypted, KEY), { channelAccessToken: 'secret' });
});
