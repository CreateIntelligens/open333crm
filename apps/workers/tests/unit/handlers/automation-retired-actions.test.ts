/**
 * workers 執行規則前驗證契約（change fix-automation-remaining-actions，AUDIT AUTO-01）。
 * remove_tag 補上實作後照常執行；從契約拿掉的動作（例如 llm_reply）讓驗證失敗，整條規則略過。
 * 原本這些動作列在「尚未支援」清單，workers 以 allowUnsupportedActions 放行、只略過該動作。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { handleAutomationJob } from '#src/handlers/automation.handler';

async function runRule(actions: unknown[]) {
  const rule = { id: 'rule-1', name: '規則', priority: 10, stopOnMatch: false, conditions: { all: [] }, actions };
  const prisma = { automationRule: { findMany: async () => [rule] } };
  const published: string[] = [];
  const redisPublisher = { publish: async (_c: string, payload: string) => (published.push(payload), 1) };
  await handleAutomationJob(
    { data: { tenantId: 'tenant-1', trigger: 'keyword.matched', context: { ruleId: rule.id, messageContent: 'x', matchedKeywords: ['x'] } } } as never,
    prisma as never,
    redisPublisher as never,
  );
  return published.some((p) => p.includes(rule.id));
}

test('Existing rule still runs its other actions：含 send_message 與 remove_tag 的規則照常執行', async () => {
  assert.equal(
    await runRule([
      { type: 'send_message', params: { text: 'hi' } },
      { type: 'remove_tag', params: { tagName: 'VIP' } },
    ]),
    true,
  );
});

test('Retired action in an existing rule：含 llm_reply 的規則整條略過', async () => {
  assert.equal(
    await runRule([
      { type: 'send_message', params: { text: 'hi' } },
      { type: 'llm_reply', params: {} },
    ]),
    false,
  );
});
