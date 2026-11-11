/**
 * JSON 請求內容上限的環境設定（change limit-request-array-size，spec request-payload-limits「上限可由環境變數設定」）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseEnvConfig } from '#src/config/env.js';

const requiredEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/open333',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'test-jwt-secret-12345',
  CREDENTIAL_ENCRYPTION_KEY: '12345678901234567890123456789012',
};

test('未設定時使用預設值', () => {
  const cfg = parseEnvConfig({ ...requiredEnv }) as Record<string, unknown>;
  assert.equal(cfg.REQUEST_JSON_MAX_ARRAY_LENGTH, 10_000);
  assert.equal(cfg.REQUEST_JSON_MAX_OBJECT_KEYS, 10_000);
  assert.equal(cfg.REQUEST_JSON_MAX_TOTAL_ENTRIES, 100_000);
  assert.equal(cfg.REQUEST_JSON_MAX_DEPTH, 64);
});

test('設定的值會覆寫預設值', () => {
  const cfg = parseEnvConfig({
    ...requiredEnv,
    REQUEST_JSON_MAX_ARRAY_LENGTH: '20000',
    REQUEST_JSON_MAX_OBJECT_KEYS: '300',
    REQUEST_JSON_MAX_TOTAL_ENTRIES: '400000',
    REQUEST_JSON_MAX_DEPTH: '32',
  }) as Record<string, unknown>;
  assert.equal(cfg.REQUEST_JSON_MAX_ARRAY_LENGTH, 20_000);
  assert.equal(cfg.REQUEST_JSON_MAX_OBJECT_KEYS, 300);
  assert.equal(cfg.REQUEST_JSON_MAX_TOTAL_ENTRIES, 400_000);
  assert.equal(cfg.REQUEST_JSON_MAX_DEPTH, 32);
});

test('設定錯誤的值', () => {
  for (const bad of ['0', 'abc', '-5', '1.5']) {
    assert.throws(
      () => parseEnvConfig({ ...requiredEnv, REQUEST_JSON_MAX_ARRAY_LENGTH: bad }),
      /REQUEST_JSON_MAX_ARRAY_LENGTH/,
      `值 ${bad} 應該被拒絕`,
    );
  }
  assert.throws(() => parseEnvConfig({ ...requiredEnv, REQUEST_JSON_MAX_DEPTH: '0' }), /REQUEST_JSON_MAX_DEPTH/);
});
