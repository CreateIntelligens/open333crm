/**
 * AI 只在關鍵字規則能在該渠道回覆時讓步（change fix-keyword-yield-ig-delivery，
 * spec automation-engine「AI 只在關鍵字規則能在該渠道回覆時讓步」）。
 *
 * 背景（2026-10-14）：IG 私訊「你好」命中只送 LINE 素材的規則，AI 讓步、素材又因渠道不符被略過，顧客什麼都沒收到。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { hasMatchingKeywordRule } from '#src/modules/automation/keyword-yield.js';

const TENANT = 't1';

function db(actions: unknown[], materials: Array<{ id: string; channelType: string }> = []) {
  return {
    automationRule: {
      findMany: async () => [
        { id: 'r1', trigger: { type: 'keyword.matched', keywords: ['Hi', '你好'], match_mode: 'any' }, conditions: { all: [] }, actions },
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

test('網站聊天室的規則送不出去', async () => {
  // workers 送不到網站聊天室（AUDIT CHAN-02），讓步的話訪客什麼都收不到
  const prisma = db([{ type: 'send_message', params: { text: '您好' } }]);
  assert.equal(await hasMatchingKeywordRule(prisma, TENANT, '你好', 'WEBCHAT'), false);
});

test('關鍵字資料有非字串值時不拋錯', async () => {
  const prisma = {
    automationRule: {
      findMany: async () => [
        { id: 'r1', trigger: { type: 'keyword.matched', keywords: [null, 42, '', '你好'] }, conditions: { all: [] }, actions: [{ type: 'send_message', params: { text: '您好' } }] },
      ],
    },
  } as never;
  assert.equal(await hasMatchingKeywordRule(prisma, TENANT, '你好', 'LINE'), true);
  assert.equal(await hasMatchingKeywordRule(prisma, TENANT, '請問營業時間', 'LINE'), false, '空字串關鍵字不會命中所有訊息');
});

// ── 讓步看規則條件與契約（change fix-automation-rule-gaps，問題清單 A09）──

function dbWithRule(rule: { conditions: unknown; actions: unknown[] }, conversation = { channelType: 'LINE' }) {
  return {
    automationRule: {
      findMany: async () => [
        { id: 'r1', trigger: { type: 'keyword.matched', keywords: ['你好'], match_mode: 'any' }, ...rule },
      ],
    },
    conversation: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
        where.id === 'conv-1' && where.tenantId === TENANT
          ? { channelType: conversation.channelType, status: 'BOT_HANDLED', assignedToId: null, caseId: null }
          : null,
    },
    contact: { findFirst: async () => null },
    case: { findFirst: async () => null, count: async () => 0 },
  } as never;
}

const channelIs = (value: string) => ({ all: [{ fact: 'conversation.channelType', operator: 'equal', value }] });
const reply = [{ type: 'send_message', params: { text: '您好' } }];

test('規則條件不成立', async () => {
  const prisma = dbWithRule({ conditions: channelIs('FB'), actions: reply });
  assert.equal(await hasMatchingKeywordRule(prisma, TENANT, '你好', 'LINE', { conversationId: 'conv-1' }), false);
});

test('規則條件成立', async () => {
  const prisma = dbWithRule({ conditions: channelIs('LINE'), actions: reply });
  assert.equal(await hasMatchingKeywordRule(prisma, TENANT, '你好', 'LINE', { conversationId: 'conv-1' }), true);
});

test('規則不合契約', async () => {
  const prisma = dbWithRule({ conditions: { all: [] }, actions: [...reply, { type: 'auto_assign', params: {} }] });
  assert.equal(await hasMatchingKeywordRule(prisma, TENANT, '你好', 'LINE', { conversationId: 'conv-1' }), false);
});

// ── 讓步判斷只在需要時讀條件資料（review #282）──

/** 讀條件資料就拋錯的資料庫：用來確認沒有讀、或讀失敗時的行為 */
function dbFactsFail(rule: { conditions: unknown; actions: unknown[] }, calls: string[] = []) {
  const fail = (model: string) => async () => {
    calls.push(model);
    throw new Error(`${model} 讀取失敗`);
  };
  return {
    automationRule: {
      findMany: async () => [
        { id: 'r1', trigger: { type: 'keyword.matched', keywords: ['你好'], match_mode: 'any' }, ...rule },
      ],
    },
    conversation: { findFirst: fail('conversation') },
    contact: { findFirst: fail('contact') },
    case: { findFirst: fail('case'), count: fail('case') },
  } as never;
}

test('沒有條件的規則不讀條件資料', async () => {
  const calls: string[] = [];
  const prisma = dbFactsFail({ conditions: { all: [] }, actions: reply }, calls);
  assert.equal(
    await hasMatchingKeywordRule(prisma, TENANT, '你好', 'LINE', { conversationId: 'conv-1', contactId: 'ct-1' }),
    true,
  );
  assert.deepEqual(calls, []);
});

test('條件資料讀取失敗時不讓步', async () => {
  const prisma = dbFactsFail({ conditions: channelIs('LINE'), actions: reply });
  assert.equal(
    await hasMatchingKeywordRule(prisma, TENANT, '你好', 'LINE', { conversationId: 'conv-1', contactId: 'ct-1' }),
    false,
  );
});

test('沒有對話與聯絡人時，有條件的規則不讓步', async () => {
  // 條件看的是對話資料；沒有對話時無法評估，不能當作成立
  const prisma = dbWithRule({
    conditions: { all: [{ fact: 'conversation.channelType', operator: 'notEqual', value: 'FB' }] },
    actions: reply,
  });
  assert.equal(await hasMatchingKeywordRule(prisma, TENANT, '你好', 'LINE'), false);
});

// ── 發券規則也算會回覆（add-coupon-system A15 15.9、design D25）：只發券的關鍵字規則命中時，
//    AI 原本照常回覆，顧客一次收到兩則 ──


/** 模擬 Prisma 的 couponNotPastFixedEnd 條件（OR 明列可用情況） */
function notPastFixedEnd(c: { validityMode?: string | null; endAt?: Date | null }, or: Array<Record<string, any>> | undefined) {
  if (!or) return true;
  const mode = c.validityMode ?? null;
  const end = c.endAt ?? null;
  return or.some((k) =>
    ('validityMode' in k && k.validityMode === null && mode === null)
    || (k.validityMode?.in && mode !== null && k.validityMode.in.includes(mode))
    || ('endAt' in k && k.endAt === null && end === null)
    || (k.endAt?.gt && end !== null && end > k.endAt.gt));
}

function dbWithCoupon(couponStatus: string, validity: { validityMode?: string; endAt?: Date } = {}) {
  return {
    automationRule: {
      findMany: async () => [
        {
          id: 'r1',
          trigger: { type: 'keyword.matched', keywords: ['領券'], match_mode: 'any' },
          conditions: { all: [] },
          actions: [{ type: 'issue_coupon', params: { couponId: 'c-1' } }],
        },
      ],
    },
    coupon: {
      findMany: async ({ where }: { where: { id: { in: string[] }; tenantId: string; status?: string; OR?: Array<Record<string, any>> } }) =>
        [{ id: 'c-1', tenantId: TENANT, status: couponStatus, ...validity }]
          .filter((c) => where.id.in.includes(c.id) && c.tenantId === where.tenantId)
          .filter((c) => where.status === undefined || c.status === where.status)
          .filter((c) => notPastFixedEnd(c, where.OR))
          .map((c) => ({ id: c.id })),
    },
  } as never;
}

test('規則發送進行中的優惠券', async () => {
  assert.equal(await hasMatchingKeywordRule(dbWithCoupon('ACTIVE'), TENANT, '我要領券', 'LINE'), true);
});

test('規則的優惠券不是進行中', async () => {
  assert.equal(await hasMatchingKeywordRule(dbWithCoupon('PAUSED'), TENANT, '我要領券', 'LINE'), false);
});

test('規則的優惠券已過固定效期的到期日', async () => {
  // 到期後狀態仍是進行中，但 workers 不發券，AI 要照常回覆
  const expired = { validityMode: 'FIXED', endAt: new Date(Date.now() - 60_000) };
  assert.equal(await hasMatchingKeywordRule(dbWithCoupon('ACTIVE', expired), TENANT, '我要領券', 'LINE'), false);
  const later = { validityMode: 'FIXED', endAt: new Date(Date.now() + 86_400_000) };
  assert.equal(await hasMatchingKeywordRule(dbWithCoupon('ACTIVE', later), TENANT, '我要領券', 'LINE'), true);
});

test('網站聊天室的發券規則', async () => {
  assert.equal(await hasMatchingKeywordRule(dbWithCoupon('ACTIVE'), TENANT, '我要領券', 'WEBCHAT'), false);
});
