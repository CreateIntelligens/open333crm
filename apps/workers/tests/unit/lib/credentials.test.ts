/**
 * Workers 解密渠道憑證只用 CREDENTIAL_ENCRYPTION_KEY（主規格 credential-encryption，AUDIT SEC-01）。
 * 原本缺少金鑰時改用寫在原始碼裡的預設字串，任何看得到原始碼的人都能解密用預設字串加密的憑證。
 */
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { afterEach, test } from 'vitest';
import { decryptCredentials } from '#src/lib/credentials.js';

const KEY = 'test-credential-encryption-key-32-bytes!!';
const originalKey = process.env.CREDENTIAL_ENCRYPTION_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  else process.env.CREDENTIAL_ENCRYPTION_KEY = originalKey;
});

/** 與 API 的 encryptCredentials()（apps/api/src/modules/channel/channel.service.ts）相同的格式 */
function encryptLikeApi(plain: Record<string, unknown>, secret: string): string {
  const key = scryptSync(secret, 'open333crm-credentials', 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(JSON.stringify(plain), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted}`;
}

test('Workers 解密時金鑰缺少或太短：拋出錯誤，不改用預設字串', () => {
  const encrypted = encryptLikeApi({ channelAccessToken: 'secret' }, 'fallback-open333crm-key');

  delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  assert.throws(() => decryptCredentials(encrypted), /CREDENTIAL_ENCRYPTION_KEY must be set to at least 32 characters/);

  process.env.CREDENTIAL_ENCRYPTION_KEY = 'too-short';
  assert.throws(() => decryptCredentials(encrypted), /CREDENTIAL_ENCRYPTION_KEY must be set to at least 32 characters/);
});

test('有金鑰時加密後可以還原：Workers 解密 API 格式的密文', () => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = KEY;
  const encrypted = encryptLikeApi({ channelAccessToken: 'secret' }, KEY);
  assert.deepEqual(decryptCredentials(encrypted), { channelAccessToken: 'secret' });
});
