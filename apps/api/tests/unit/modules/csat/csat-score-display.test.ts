/**
 * 評分後客服看得到結果（issue #444，change show-csat-score-444）：
 * - 問卷訊息的 metadata 寫入分數與評分者，並再推一次 message.new，收件匣的問卷卡片顯示分數。
 * - 工單時間軸寫一筆 csat_rated，評分後自動關閉寫一筆 status_changed。
 * 資料庫以替身實作 recordCsatScore() 用到的方法；JSON 條件與租戶條件另見
 * tests/feature/modules/csat/csat-record-scope.test.ts。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import type { Server as SocketIOServer } from 'socket.io';
import type { TenantDb } from '#src/lib/tenant-db.js';
import { disabledAiPrivacy } from '../../../support/ai-privacy.js';

vi.mock('#src/modules/conversation/conversation.service.js', () => ({
  deliverToChannel: async () => true,
  closeConversationsForCase: async () => 0,
}));

const { recordCsatScore } = await import('#src/modules/csat/csat.service.js');

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';
const CASE_ID = 'case-1';
const AGENT_ID = 'agent-1';

interface Emitted { rooms: string[]; event: string; payload: { message?: { id: string; metadata?: Record<string, unknown> } } }

let emitted: Emitted[];
let caseEvents: Array<Record<string, unknown>>;
let messageUpdates: Array<{ where: Record<string, unknown>; data: { metadata: Record<string, unknown> } }>;
let surveyQueries: unknown[];

const io = {
  to: (rooms: string | string[]) => ({
    emit: (event: string, payload: Emitted['payload']) => {
      emitted.push({ rooms: [rooms].flat(), event, payload });
    },
  }),
} as unknown as SocketIOServer;

function createDb() {
  return {
    ...disabledAiPrivacy,
    case: {
      findFirst: async () => ({
        id: CASE_ID,
        tenantId: TENANT_ID,
        contactId: 'contact-1',
        channelId: 'channel-1',
        assigneeId: null,
        title: '冷氣不冷',
        priority: 'MEDIUM',
        status: 'RESOLVED',
        csatScore: null,
        conversations: [{ id: 'conv-1', channelId: 'channel-1' }],
      }),
      // issue #339：評分以條件更新認領
      updateMany: async () => ({ count: 1 }),
      update: async () => ({}),
      count: async () => 1,
    },
    message: {
      findMany: async (args: unknown) => {
        surveyQueries.push(args);
        return [{
          id: 'survey-1',
          conversationId: 'conv-1',
          direction: 'OUTBOUND',
          senderType: 'SYSTEM',
          contentType: 'csat',
          content: { text: '滿意度調查', caseId: CASE_ID },
          metadata: { type: 'csat_survey', caseId: CASE_ID },
          createdAt: new Date('2026-11-04T04:36:00Z'),
          conversation: { channelId: 'channel-1' },
        }];
      },
      updateMany: async (args: { where: Record<string, unknown>; data: { metadata: Record<string, unknown> } }) => {
        messageUpdates.push(args);
        return { count: 1 };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: 'followup-1', createdAt: new Date(), ...data }),
    },
    caseEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        caseEvents.push(data);
        return data;
      },
    },
    conversation: { update: async () => ({}) },
    agent: { findMany: async () => [] },
    // issue #339：低分通知的收件人（沒有方案、沒有角色 → 沒有收件人）
    tenant: { findUnique: async () => ({ planId: null }) },
    role: { findMany: async () => [] },
  } as unknown as TenantDb;
}

beforeEach(() => {
  emitted = [];
  caseEvents = [];
  messageUpdates = [];
  surveyQueries = [];
});

test('客人評分後問卷卡片顯示分數', async () => {
  const recorded = await recordCsatScore(createDb(), io, CASE_ID, 2, undefined, { tenantId: TENANT_ID, contactId: 'contact-1' });
  assert.equal(recorded, true);

  // 只找這個租戶、這張工單的問卷訊息
  const query = surveyQueries[0] as { where: Record<string, unknown> };
  assert.equal(query.where.contentType, 'csat');
  assert.deepEqual(query.where.metadata, { path: ['caseId'], equals: CASE_ID });
  assert.deepEqual(query.where.conversation, { tenantId: TENANT_ID, caseId: CASE_ID });

  assert.equal(messageUpdates.length, 1);
  assert.equal(messageUpdates[0]!.where.id, 'survey-1');
  assert.deepEqual(messageUpdates[0]!.where.conversation, { tenantId: TENANT_ID });
  const metadata = messageUpdates[0]!.data.metadata;
  assert.equal(metadata.csatScore, 2);
  assert.equal(metadata.csatRatedBy, 'customer');
  assert.equal(metadata.caseId, CASE_ID, '原有的 metadata 保留');

  const surveyPush = emitted.filter((e) => e.event === 'message.new' && e.payload.message?.id === 'survey-1');
  assert.equal(surveyPush.length, 1, '問卷訊息再推一次 message.new');
  assert.equal(surveyPush[0]!.payload.message?.metadata?.csatScore, 2);
  assert.ok(surveyPush[0]!.rooms.includes(`tenant:${TENANT_ID}:channel:channel-1`), '推到渠道房間');
  // 對話列表的最後一則仍是感謝訊息：問卷的推送在感謝訊息之前
  const order = emitted.filter((e) => e.event === 'message.new').map((e) => e.payload.message?.id);
  assert.deepEqual(order, ['survey-1', 'followup-1']);
});

test('客服代評後問卷卡片標明客服代評', async () => {
  const recorded = await recordCsatScore(createDb(), io, CASE_ID, 4, undefined, { tenantId: TENANT_ID, agentId: AGENT_ID });
  assert.equal(recorded, true);

  assert.equal(messageUpdates[0]!.data.metadata.csatScore, 4);
  assert.equal(messageUpdates[0]!.data.metadata.csatRatedBy, 'agent');
});

test('客人評分後時間軸有評分與自動關閉紀錄', async () => {
  await recordCsatScore(createDb(), io, CASE_ID, 2, undefined, { tenantId: TENANT_ID, contactId: 'contact-1' });

  const rated = caseEvents.find((e) => e.eventType === 'csat_rated');
  assert.ok(rated, '有 csat_rated 事件');
  assert.equal(rated.caseId, CASE_ID);
  assert.equal(rated.actorType, 'contact');
  assert.deepEqual(rated.payload, { score: 2, source: 'customer' });

  const closed = caseEvents.find((e) => e.eventType === 'status_changed');
  assert.ok(closed, '有自動關閉的 status_changed 事件');
  assert.equal(closed.actorType, 'system');
  assert.deepEqual(closed.payload, { from: 'RESOLVED', to: 'CLOSED', reason: 'csat_rated' });
});

test('客服代評的時間軸紀錄標明客服', async () => {
  await recordCsatScore(createDb(), io, CASE_ID, 4, undefined, { tenantId: TENANT_ID, agentId: AGENT_ID });

  const rated = caseEvents.find((e) => e.eventType === 'csat_rated');
  assert.ok(rated, '有 csat_rated 事件');
  assert.equal(rated.actorType, 'agent');
  assert.equal(rated.actorId, AGENT_ID);
  assert.deepEqual(rated.payload, { score: 4, source: 'agent' });
});

/**
 * issue #339（csat-survey「低分只通知負責工單的成員」）：低分通知送不出時不可只寫 log，
 * 工單時間軸留一筆 csat_low_score_notify_failed，分數與結案照常。
 */
test('低分通知送不出時客服看得到', async () => {
  const db = createDb() as unknown as Record<string, unknown>;
  db.tenant = { findUnique: async () => { throw new Error('connection reset'); } };

  const recorded = await recordCsatScore(db as unknown as TenantDb, io, CASE_ID, 2, undefined, { tenantId: TENANT_ID, contactId: 'contact-1' });

  assert.equal(recorded, true);
  const failed = caseEvents.find((e) => e.eventType === 'csat_low_score_notify_failed');
  assert.ok(failed, '有 csat_low_score_notify_failed 事件');
  assert.equal(failed.actorType, 'system');
  assert.ok(caseEvents.some((e) => e.eventType === 'status_changed'), '工單照常結案');
});
