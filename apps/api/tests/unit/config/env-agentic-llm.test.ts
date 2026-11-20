/**
 * AGENTIC_LLM_ENABLED 的預設值（spec agentic-llm-orchestration「Agent 關閉時走知識庫回覆」）。
 *
 * Agent 沒有知識庫搜尋工具。Agent 開啟時，它每次都先回覆，知識庫回覆不執行。所以預設關閉。
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

test('沒有設定 AGENTIC_LLM_ENABLED 時 Agent 關閉', () => {
  assert.equal(parseEnvConfig({ ...requiredEnv }).AGENTIC_LLM_ENABLED, false);
});

test('AGENTIC_LLM_ENABLED=true 時 Agent 開啟', () => {
  assert.equal(parseEnvConfig({ ...requiredEnv, AGENTIC_LLM_ENABLED: 'true' }).AGENTIC_LLM_ENABLED, true);
});
