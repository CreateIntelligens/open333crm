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

vi.mock('#src/modules/conversation/conversation.service.js', () => ({
  deliverToChannel: async (...args: unknown[]) => {
    delivered.push(args);
    return true;
  },
}));

const { sendCsatSurvey } = await import('#src/modules/csat/csat.service.js');

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';
const CASE_ID = 'case-1';

const io = { to: () => ({ emit: () => {} }) } as unknown as SocketIOServer;

/**
 * 讀取時工單還沒寄過問卷；認領時 updateMany 回傳 claimedCount。
 * claimedCount 為 0 代表讀取之後，別次執行已經寄出，或客服已經重開工單。
 */
function createDb(claimedCount: number) {
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
