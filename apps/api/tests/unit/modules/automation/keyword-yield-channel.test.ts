/**
 * AI 只在關鍵字規則能在該渠道回覆時讓步（change fix-keyword-yield-ig-delivery，
 * spec automation-engine「AI 只在關鍵字規則能在該渠道回覆時讓步」）。
 *
 * 背景（2026-10-14）：IG 私訊「你好」命中只送 LINE 素材的規則，AI 讓步、素材又因渠道不符被略過，顧客什麼都沒收到。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { hasMatchingKeywordRule } from '#src/modules/automation/automation.worker.js';

const TENANT = 't1';

function db(actions: unknown[], materials: Array<{ id: string; channelType: string }> = []) {
  return {
    automationRule: {
      findMany: async () => [
        { id: 'r1', trigger: { type: 'keyword.matched', keywords: ['Hi', '你好'], match_mode: 'any' }, actions },
      ],
    },
    material: {
      findMany: async ({ where }: { where: { id: { in: string[] }; tenantId: string } }) =>
        materials.filter((m) => where.id.in.includes(m.id) && where.tenantId === TENANT),
    },
  } as never;
}

const sendMaterial = (materialId: string) => ({ type: 'send_material', params: { materialId } });

test('規則的素材是這個渠道的', async () => {
  const prisma = db([sendMaterial('m-ig')], [{ id: 'm-ig', channelType: 'threads' }]);
  assert.equal(await hasMatchingKeywordRule(prisma, TENANT, '你好', 'THREADS'), true);
});

test('規則的素材是別的渠道的', async () => {
  const prisma = db([sendMaterial('m-line')], [{ id: 'm-line', channelType: 'line' }]);
  assert.equal(await hasMatchingKeywordRule(prisma, TENANT, '你好', 'THREADS'), false);
});

test('規則傳送文字', async () => {
  const prisma = db([{ type: 'send_message', params: { text: '您好' } }]);
  assert.equal(await hasMatchingKeywordRule(prisma, TENANT, '你好', 'THREADS'), true);
});

test('規則不回覆顧客', async () => {
  const prisma = db([{ type: 'add_tag', params: { tagName: '打招呼' } }]);
  assert.equal(await hasMatchingKeywordRule(prisma, TENANT, '你好', 'THREADS'), false);
});

test('沒有命中任何規則', async () => {
  const prisma = db([{ type: 'send_message', params: { text: '您好' } }]);
  assert.equal(await hasMatchingKeywordRule(prisma, TENANT, '請問營業時間', 'THREADS'), false);
});
