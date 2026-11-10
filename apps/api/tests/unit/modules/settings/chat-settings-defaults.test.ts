/**
 * spec chat-settings「讀取 Chat 設定不寫入資料庫」：資料庫欄位的預設值與 DEFAULT_CHAT_SETTINGS 相同，
 * 所以「沒有設定列時回預設值」與「第一次修改設定時建立設定列」得到同一組值（change migrate-ai-llm-tenant-ctx，design D5）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { repoRoot } from '#tests/support/paths.js';
import { DEFAULT_CHAT_SETTINGS, type ChatSettings } from '#src/modules/settings/chat-settings.service.js';

const SCHEMA = join(repoRoot, 'packages/database/prisma/schema.prisma');

const COLUMN: Record<keyof ChatSettings, string> = {
  provider: 'chatProvider',
  model: 'chatModel',
  baseUrl: 'chatBaseUrl',
  temperature: 'chatTemperature',
  maxTokens: 'chatMaxTokens',
  chatSystemPrompt: 'chatSystemPrompt',
  summarizeSystemPrompt: 'summarizeSystemPrompt',
  clarifySystemPrompt: 'clarifySystemPrompt',
  modelGuideSystemPrompt: 'modelGuideSystemPrompt',
  clarifyThreshold: 'clarifyThreshold',
  clarifyMaxAttempts: 'clarifyMaxAttempts',
};

function schemaDefaults(): Record<string, string | number> {
  const schema = readFileSync(SCHEMA, 'utf8');
  const model = schema.match(/^model TenantSettings \{([\s\S]*?)^\}/m)?.[1];
  assert.ok(model, 'schema.prisma 找不到 TenantSettings');
  const defaults: Record<string, string | number> = {};
  for (const line of model.split('\n')) {
    const m = line.match(/^\s*(\w+)\s+(String|Float|Int)\s+@default\((.*)\)/);
    if (!m) continue;
    defaults[m[1]!] = m[2] === 'String' ? JSON.parse(m[3]!) : Number(m[3]);
  }
  return defaults;
}

test('DEFAULT_CHAT_SETTINGS 與 TenantSettings 的 chat 欄位預設值相同', () => {
  const defaults = schemaDefaults();
  for (const [field, column] of Object.entries(COLUMN)) {
    assert.equal(defaults[column], DEFAULT_CHAT_SETTINGS[field as keyof ChatSettings], `${column}`);
  }
});
