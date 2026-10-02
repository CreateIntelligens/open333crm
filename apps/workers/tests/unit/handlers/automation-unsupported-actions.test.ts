/**
 * 既有規則含 workers 尚未支援的動作（AUDIT AUTO-01）：規則照常評估執行，只跳過該動作，
 * 不可因契約改為存檔時拒絕這些動作，就讓整條規則（含其他能執行的動作）被跳過。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { handleAutomationJob } from '#src/handlers/automation.handler';

test('含不支援動作的既有規則：照常評估並發出執行事件', async () => {
  const rule = {
    id: 'rule-legacy-create-case',
    name: '一般問題自動開案',
    priority: 10,
    stopOnMatch: false,
    conditions: { all: [] },
    actions: [{ type: 'create_case', params: { title: '客訴' } }],
  };
  const prisma = { automationRule: { findMany: async () => [rule] } };
  const published: string[] = [];
  const redisPublisher = { publish: async (_c: string, payload: string) => (published.push(payload), 1) };

  await handleAutomationJob(
    { data: { tenantId: 'tenant-1', trigger: 'keyword.matched', context: { ruleId: rule.id, messageContent: 'x', matchedKeywords: ['x'] } } } as any,
    prisma as any,
    redisPublisher as any,
  );

  assert.ok(published.some((p) => p.includes(rule.id)), '規則不可被整條跳過');
});
