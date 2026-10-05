/**
 * workers 執行規則前驗證契約（change fix-automation-remaining-actions，AUDIT AUTO-01）。
 * remove_tag 補上實作後照常執行；從契約拿掉的動作（例如 llm_reply）讓驗證失敗，整條規則略過。
 * 原本這些動作列在「尚未支援」清單，workers 以 allowUnsupportedActions 放行、只略過該動作。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { handleAutomationJob } from '#src/handlers/automation.handler';

/** 只記錄 contactTag.deleteMany 的 prisma；其他查詢（組 facts 用）一律回空值 */
function fakePrisma(rule: Record<string, unknown>) {
  const removed: unknown[] = [];
  const empty = async () => null;
  const model = (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, { get: (target, key) => (key in target ? target[key as string] : empty) });
  const prisma = new Proxy(
    {
      automationRule: model({ findMany: async () => [rule] }),
      contactTag: model({
        deleteMany: async (args: unknown) => {
          removed.push(args);
          return { count: 1 };
        },
        findMany: async () => [],
      }),
    } as Record<string, unknown>,
    { get: (target, key) => (key in target ? target[key as string] : model({ findMany: async () => [] })) },
  );
  return { prisma, removed };
}

async function runRule(actions: unknown[]) {
  const rule = { id: 'rule-1', name: '規則', priority: 10, stopOnMatch: false, conditions: { all: [] }, actions };
  const { prisma, removed } = fakePrisma(rule);
  const published: string[] = [];
  const redisPublisher = { publish: async (_c: string, payload: string) => (published.push(payload), 1) };
  await handleAutomationJob(
    {
      data: {
        tenantId: 'tenant-1',
        trigger: 'keyword.matched',
        context: { ruleId: rule.id, contactId: 'contact-1', messageContent: 'x', matchedKeywords: ['x'] },
      },
    } as never,
    prisma as never,
    redisPublisher as never,
  );
  return { executed: published.some((p) => p.includes(rule.id)), removed };
}

test('Existing rule still runs its other actions：含 send_message 與 remove_tag 的規則照常執行，標籤確實移除', async () => {
  const { executed, removed } = await runRule([
    { type: 'send_message', params: { text: 'hi' } },
    { type: 'remove_tag', params: { tagName: 'VIP' } },
  ]);
  assert.equal(executed, true);
  assert.deepEqual(removed, [
    { where: { contactId: 'contact-1', tag: { tenantId: 'tenant-1', name: 'VIP' } } },
  ]);
});

test('Retired action in an existing rule：含 llm_reply 的規則整條略過', async () => {
  const { executed, removed } = await runRule([
    { type: 'remove_tag', params: { tagName: 'VIP' } },
    { type: 'llm_reply', params: {} },
  ]);
  assert.equal(executed, false);
  assert.equal(removed.length, 0, '整條略過，連 remove_tag 也不執行');
});
