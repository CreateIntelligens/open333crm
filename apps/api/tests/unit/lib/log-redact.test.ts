/** 請求 log 不可記下 OAuth 授權碼、state、存取權杖 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { redactSensitiveQuery } from '#src/lib/log-redact.js';

test('遮掉 code、state、access_token、token，其他參數保留', () => {
  assert.equal(
    redactSensitiveQuery('/api/v1/meta-connect/callback?code=AQKxyz&state=abc123'),
    '/api/v1/meta-connect/callback?code=<redacted>&state=<redacted>',
  );
  assert.equal(redactSensitiveQuery('/x?page=2&access_token=EAAB&limit=5'), '/x?page=2&access_token=<redacted>&limit=5');
  assert.equal(redactSensitiveQuery('/trial/verify?token=t1'), '/trial/verify?token=<redacted>');
  assert.equal(redactSensitiveQuery('/x?error_code=1&statement=a'), '/x?error_code=1&statement=a', '名稱只是包含 code／state 的參數不受影響');
});

test('沒有參數或空值時原樣回傳', () => {
  assert.equal(redactSensitiveQuery('/health'), '/health');
  assert.equal(redactSensitiveQuery(undefined), undefined);
});
