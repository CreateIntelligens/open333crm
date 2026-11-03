/**
 * 滿意度問卷送到客人的渠道（issue #416，change fix-csat-line-flex-416）。
 *
 * - LINE 客人收到的是 Flex 問卷：以前 LINE 外掛沒有 `flex` 分支，問卷變成空白文字被 LINE 拒收。
 * - 送出失敗時客服看得到：問卷訊息標示「沒有送出」、工單時間軸多一筆 `csat_send_failed`，
 *   `csatSentAt` 不還原（不自動重寄）。
 *
 * 只替換最低層的 HTTP（fetch）與憑證解密，LINE 外掛用真的 linePlugin。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import type { Server as SocketIOServer } from 'socket.io';
import type { TenantDb } from '#src/lib/tenant-db.js';

const fb = vi.hoisted(() => ({ delivered: true }));

vi.mock('#src/modules/conversation/conversation.service.js', () => ({
  deliverToChannel: async () => fb.delivered,
}));
vi.mock('#src/modules/channel/channel.service.js', () => ({
  decryptCredentials: () => ({ channelAccessToken: 'token' }),
}));
vi.mock('@open333crm/channel-plugins', async () => {
  const actual = await vi.importActual<typeof import('@open333crm/channel-plugins')>('@open333crm/channel-plugins');
  return { ...actual, getChannelPlugin: (type: string) => (type === 'LINE' ? actual.linePlugin : undefined) };
});

const { sendCsatSurvey } = await import('#src/modules/csat/csat.service.js');

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';
const CASE_ID = 'b0000000-0000-0000-0000-000000000001';

const originalFetch = globalThis.fetch;
let lineBodies: Array<{ to: string; messages: Array<Record<string, unknown>> }>;
let lineStatus: number;

beforeEach(() => {
  lineBodies = [];
  lineStatus = 200;
  fb.delivered = true;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    lineBodies.push(JSON.parse(String(init?.body)));
    const body = lineStatus === 200 ? '{}' : '{"message":"The request body has 1 error(s)"}';
    return new Response(body, { status: lineStatus, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function createHarness(channelType: 'LINE' | 'FB', opts: { identity?: boolean } = {}) {
  const emits: Array<{ event: string; data: { message: { metadata?: Record<string, unknown> } } }> = [];
  const io = {
    to: () => ({ emit: (event: string, data: never) => emits.push({ event, data }) }),
  } as unknown as SocketIOServer;
  const messageUpdates: Array<{ where: Record<string, unknown>; data: { metadata: Record<string, unknown> } }> = [];
  const caseEvents: Array<{ data: Record<string, unknown> }> = [];
  const caseUpdates: unknown[] = [];
  const db = {
    case: {
      findUnique: async () => ({
        id: CASE_ID,
        tenantId: TENANT_ID,
        contactId: 'contact-1',
        status: 'RESOLVED',
        csatSentAt: null,
        conversations: [
          { id: 'conv-1', channelId: 'channel-1', channelType, channel: { id: 'channel-1', isActive: true, credentialsEncrypted: 'x' } },
        ],
      }),
      updateMany: async () => ({ count: 1 }),
      update: async (args: unknown) => {
        caseUpdates.push(args);
        return {};
      },
    },
    channelIdentity: {
      findFirst: async () => (opts.identity === false ? null : { uid: 'U-line-user' }),
    },
    message: {
      create: async (args: { data: Record<string, unknown> }) => ({ id: 'msg-csat', ...args.data }),
      update: async (args: never) => {
        messageUpdates.push(args);
        return {};
      },
    },
    caseEvent: {
      create: async (args: never) => {
        caseEvents.push(args);
        return {};
      },
    },
    conversation: { update: async () => ({}) },
  };
  return { db: db as unknown as TenantDb, io, emits, messageUpdates, caseEvents, caseUpdates };
}

test('LINE 客人收到的問卷是 Flex 訊息', async () => {
  const h = createHarness('LINE');

  assert.equal(await sendCsatSurvey(h.db, h.io, CASE_ID), true);

  assert.equal(lineBodies.length, 1);
  const [message] = lineBodies[0].messages;
  assert.equal(message.type, 'flex');
  assert.ok(typeof message.altText === 'string' && message.altText.length > 0);
  const footer = (message.contents as { footer: { contents: Array<{ action: { data: string } }> } }).footer;
  assert.deepEqual(
    footer.contents.map((b) => b.action.data),
    [1, 2, 3, 4, 5].map((n) => `csat:${n}:${CASE_ID}`),
  );
  assert.equal(h.messageUpdates.length, 0, '送出成功不寫失敗紀錄');
  assert.equal(h.caseEvents.length, 0);
});

test('問卷送出失敗時客服看得到：LINE 拒收', async () => {
  lineStatus = 400;
  const h = createHarness('LINE');

  assert.equal(await sendCsatSurvey(h.db, h.io, CASE_ID), true);

  assert.equal(h.messageUpdates.length, 1);
  assert.equal(h.messageUpdates[0].where.id, 'msg-csat');
  const metadata = h.messageUpdates[0].data.metadata;
  assert.equal(metadata.deliveryFailed, true);
  assert.equal(metadata.type, 'csat_survey', '保留原本的問卷 metadata');
  assert.match(String(metadata.deliveryError), /400/);

  assert.equal(h.caseEvents.length, 1);
  assert.equal(h.caseEvents[0].data.caseId, CASE_ID);
  assert.equal(h.caseEvents[0].data.eventType, 'csat_send_failed');
  assert.equal(h.caseEvents[0].data.actorType, 'system');

  const failedPush = h.emits.filter((e) => e.event === 'message.new').at(-1);
  assert.equal(failedPush?.data.message.metadata?.deliveryFailed, true, '再推一次 message.new 讓聊天視窗顯示失敗');
  assert.equal(h.caseUpdates.length, 0, '不還原 csatSentAt，不自動重寄');
});

test('問卷送出失敗時客服看得到：找不到客人的 LINE 帳號', async () => {
  const h = createHarness('LINE', { identity: false });

  await sendCsatSurvey(h.db, h.io, CASE_ID);

  assert.equal(lineBodies.length, 0);
  assert.equal(h.messageUpdates[0]?.data.metadata.deliveryFailed, true);
  assert.match(String(h.messageUpdates[0]?.data.metadata.deliveryError), /帳號/);
  assert.equal(h.caseEvents[0]?.data.eventType, 'csat_send_failed');
});

test('問卷送出失敗時客服看得到：其他渠道送不出', async () => {
  fb.delivered = false;
  const h = createHarness('FB');

  await sendCsatSurvey(h.db, h.io, CASE_ID);

  assert.equal(h.messageUpdates[0]?.data.metadata.deliveryFailed, true);
  assert.equal(h.caseEvents[0]?.data.eventType, 'csat_send_failed');
});
