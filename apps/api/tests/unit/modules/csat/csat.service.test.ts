/**
 * 寄送滿意度問卷：排程的 job 可能重跑、兩期可能重疊，客服也可能在排程讀取之後重開工單。
 * sendCsatSurvey() 要先以條件更新認領工單，認領失敗就不建立問卷訊息、不送到渠道。
 * 對應 openspec/changes/claim-csat-schedule-rows/specs/csat-survey/spec.md。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import type { Server as SocketIOServer } from 'socket.io';
import type { TenantDb } from '#src/lib/tenant-db.js';

const delivered = vi.hoisted(() => [] as unknown[][]);
const delivery = vi.hoisted(() => ({ error: undefined as Error | undefined }));

vi.mock('#src/modules/conversation/conversation.service.js', () => ({
  deliverToChannel: async (...args: unknown[]) => {
    delivered.push(args);
    if (delivery.error) throw delivery.error;
    return true;
  },
}));

const { sendCsatSurvey, recordCsatScore } = await import('#src/modules/csat/csat.service.js');

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';
const CASE_ID = 'case-1';

const io = { to: () => ({ emit: () => {} }) } as unknown as SocketIOServer;

/**
 * 讀取時工單還沒寄過問卷；認領時 updateMany 回傳 claimedCount。
 * claimedCount 為 0 代表讀取之後，別次執行已經寄出，或客服已經重開工單。
 */
function createDb(claimedCount: number, messageCreateError?: Error) {
  const order: string[] = [];
  const updateManyCalls: unknown[] = [];
  const messageCreateCalls: unknown[] = [];
  const db = {
    case: {
      findUnique: async () => ({
        id: CASE_ID,
        tenantId: TENANT_ID,
        contactId: 'contact-1',
        status: 'RESOLVED',
        csatSentAt: null,
        conversations: [
          { id: 'conv-1', channelType: 'WEBCHAT', channel: { id: 'channel-1', isActive: true } },
        ],
      }),
      updateMany: async (args: unknown) => {
        order.push('case.updateMany');
        updateManyCalls.push(args);
        return { count: claimedCount };
      },
      update: async () => {
        order.push('case.update');
        return {};
      },
    },
    message: {
      create: async (args: { data: Record<string, unknown> }) => {
        order.push('message.create');
        messageCreateCalls.push(args);
        if (messageCreateError) throw messageCreateError;
        return { id: 'msg-1', ...args.data };
      },
    },
    conversation: {
      update: async () => ({}),
    },
  };
  return { db: db as unknown as TenantDb, order, updateManyCalls, messageCreateCalls };
}

test('排程讀取之後，別次執行已經寄出問卷', async () => {
  delivered.length = 0;
  const { db, messageCreateCalls } = createDb(0);

  const sent = await sendCsatSurvey(db, io, CASE_ID);

  assert.equal(sent, false);
  assert.equal(messageCreateCalls.length, 0);
  assert.equal(delivered.length, 0);
});

test('排程讀取之後，客服重開了工單', async () => {
  delivered.length = 0;
  const { db, updateManyCalls, messageCreateCalls } = createDb(0);

  const sent = await sendCsatSurvey(db, io, CASE_ID);

  assert.equal(sent, false);
  assert.equal(updateManyCalls.length, 1);
  const { where } = updateManyCalls[0] as { where: Record<string, unknown> };
  assert.equal(where.id, CASE_ID);
  assert.equal(where.tenantId, TENANT_ID);
  assert.equal(where.status, 'RESOLVED');
  assert.equal(where.csatSentAt, null);
  assert.equal(messageCreateCalls.length, 0);
  assert.equal(delivered.length, 0);
});

test('工單到了寄送時間，寄出一份問卷', async () => {
  delivered.length = 0;
  const { db, order, messageCreateCalls } = createDb(1);

  const sent = await sendCsatSurvey(db, io, CASE_ID);

  assert.equal(sent, true);
  assert.equal(messageCreateCalls.length, 1);
  assert.equal(delivered.length, 1);
  assert.deepEqual(order, ['case.updateMany', 'message.create']);
});

// 認領之後寄送最多執行一次：任何一步失敗都不還原 csatSentAt，避免訊息其實已寫入時重寄
test('認領之後建立問卷訊息失敗', async () => {
  delivered.length = 0;
  const failure = new Error('connection reset');
  const { db, updateManyCalls } = createDb(1, failure);

  await assert.rejects(sendCsatSurvey(db, io, CASE_ID), failure);

  assert.equal(updateManyCalls.length, 1);
  assert.equal(delivered.length, 0);
});

test('送到客人的渠道失敗', async () => {
  delivered.length = 0;
  delivery.error = new Error('channel unavailable');
  try {
    const { db, updateManyCalls, messageCreateCalls } = createDb(1);

    const sent = await sendCsatSurvey(db, io, CASE_ID);

    assert.equal(sent, true);
    assert.equal(messageCreateCalls.length, 1);
    assert.equal(updateManyCalls.length, 1);
    assert.equal(delivered.length, 1);
  } finally {
    delivery.error = undefined;
  }
});

/**
 * 啟用 AI 去識別化的租戶：系統固定的感謝訊息原文送出、原文存入對話，遮罩版另存給模型
 * （spec ai-input-deidentification「System template message keeps its authored text」）。
 * 只替換最低層的 HTTP 呼叫，模擬 2md 把「好評」誤判成人名。
 */
test('System template message keeps its authored text: CSAT follow-up', async () => {
  delivered.length = 0;
  vi.stubGlobal('fetch', async (_url: string, options: RequestInit) => {
    const { text } = JSON.parse(options.body as string) as { text: string };
    return Response.json({ code: 200, data: { status: 'ok', text: text.replace('好評', '[姓名]') } });
  });
  try {
    const created: Array<Record<string, unknown>> = [];
    const db = {
      platformSetting: { findUnique: async () => ({ value: { enabled: true } }) },
      case: {
        findFirst: async () => ({ id: CASE_ID, tenantId: TENANT_ID, csatScore: null, conversations: [{ id: 'conv-1' }] }),
        update: async () => ({}),
      },
      message: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: 'msg-1', createdAt: new Date(), ...data };
        },
      },
      conversation: { update: async () => ({}) },
    } as unknown as TenantDb;

    assert.equal(await recordCsatScore(db, io, CASE_ID, 5, undefined, { tenantId: TENANT_ID }), true);

    const text = (created[0].content as { text: string }).text;
    assert.equal(text, '非常感謝您的好評！您的肯定是我們最大的動力，期待再次為您服務！');
    assert.equal(delivered[0][2], text, '送給顧客的與紀錄相同');
    const privacy = (created[0].metadata as { privacy: { maskedContent: { text: string } } }).privacy;
    assert.match(privacy.maskedContent.text, /\[姓名\]/);
  } finally {
    vi.unstubAllGlobals();
  }
});
