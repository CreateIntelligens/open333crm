/**
 * csat 的交易邊界（change migrate-csat-tenant-ctx）：
 * - 寄問卷：寄出時間與問卷訊息一起寫入，問卷訊息寫入失敗時兩者都不留下（MODIFIED「認領之後建立問卷訊息失敗」）。
 * - 記分：分數到 case.closed 一起寫入，結案寫入失敗時都不留下；之後可以再評分（ADDED「記分的寫入一起成功或一起失敗」）。
 * - 問卷逾時結案：case.closed 寫進 outbox，與工單改成 CLOSED 一起 commit。
 *
 * 寫入失敗以 owner 連線建立的暫時 trigger 製造（真的資料庫錯誤），不在正式程式加測試用的掛鉤。
 * 本檔建立自己的租戶，afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { linePlugin, registerChannelPlugin } from '@open333crm/channel-plugins';
import { loadEnvConfig } from '#src/config/env.js';
import { encryptCredentials } from '#src/modules/channel/channel.service.js';
import { recordCsatScoreFlow, sendCsatSurveyFlow, type CsatFlowDeps } from '#src/modules/csat/csat.flow.js';
import { createOutboxPublisher, type EventPublisher } from '#src/events/outbox-publisher.js';
import { setupCsatScheduler } from '#src/modules/csat/csat.scheduler.js';
import { recordingIo, type PushRecord } from '#tests/support/tenant-run.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
/** 只寫 outbox，不送進佇列 */
const events: EventPublisher = { write: createOutboxPublisher(prisma).write, dispatch: async () => {} };
const stamp = `csat-tx-${Date.now().toString(36)}`;
const fn = `csat_tx_fail_${Date.now().toString(36)}`;
const pushes: PushRecord[] = [];
const io = recordingIo(pushes);

/** 渠道外掛：沿用真的問卷版型，只記錄送出，不呼叫 LINE */
const sent: Array<{ uid: string; contentType: string }> = [];
registerChannelPlugin({
  ...linePlugin,
  channelType: 'LINE',
  buildCsatSurvey: linePlugin.buildCsatSurvey,
  sendMessage: async (uid: string, message: { contentType: string }) => {
    sent.push({ uid, contentType: message.contentType });
    return { success: true, messageId: `m-${sent.length}` };
  },
} as never);

let tenantId = '';
let channelId = '';
let contactId = '';
const triggers: string[] = [];

async function makeCase(title: string, status: 'RESOLVED' | 'IN_PROGRESS' = 'RESOLVED', extra: Record<string, unknown> = {}) {
  const resolvedAt = new Date(Date.now() - 60 * 60 * 1000);
  const c = await owner.case.create({ data: { tenantId, contactId, channelId, title: `${stamp} ${title}`, status, resolvedAt, ...extra } });
  const conv = await owner.conversation.create({ data: { tenantId, contactId, channelId, channelType: 'LINE', caseId: c.id } });
  return { caseId: c.id, conversationId: conv.id };
}

/** 對一張表建立只影響指定資料列的 BEFORE trigger，afterEach 移除 */
async function failWhen(table: 'messages' | 'cases', name: string, condition: string) {
  const trig = `${fn}_${name}`;
  await owner.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${trig}() RETURNS trigger AS $$ BEGIN
    IF ${condition} THEN RAISE EXCEPTION 'csat-tx test failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
  await owner.$executeRawUnsafe(`CREATE TRIGGER ${trig} BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${trig}()`);
  triggers.push(`${trig}|${table}`);
}

async function dropTriggers() {
  for (const entry of triggers.splice(0)) {
    const [trig, table] = entry.split('|');
    await owner.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trig} ON ${table}`);
    await owner.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trig}()`);
  }
}

// ---- 入口：搬遷前呼叫舊的函式，搬遷後改呼叫 flow（task 2.7） ----

/** 排程與進站的依賴：conversation 的兩個函式用繞過 RLS 的連線（design D4） */
const deps = (): CsatFlowDeps => ({ prisma, io, events, conversationDb: owner });

function sendSurvey(caseId: string) {
  return sendCsatSurveyFlow(deps(), { tenantId, caseId });
}

function rate(caseId: string, score: number) {
  return recordCsatScoreFlow(deps(), { caseId, score, scope: { tenantId, contactId } });
}

async function runAutoClose(caseId: string) {
  const runs: Record<string, () => Promise<void>> = {};
  const scoped = new Proxy(owner, {
    get(target, prop) {
      if (prop !== 'case') return Reflect.get(target, prop);
      return new Proxy(target.case, {
        get(model, key) {
          if (key === 'findMany') {
            return (args: { where: Record<string, unknown> }) => model.findMany({ ...args, where: { ...args.where, id: caseId } } as never);
          }
          return Reflect.get(model, key);
        },
      });
    },
  });
  setupCsatScheduler({ registerSchedule: (s: { id: string; run: () => Promise<void> }) => { runs[s.id] = s.run; } } as never, { admin: scoped as never, prisma, io, events });
  await runs['csat-auto-close']();
}

const outboxCaseClosed = (caseId: string) =>
  owner.outbox.count({ where: { tenantId, name: 'case.closed', payload: { path: ['caseId'], equals: caseId } } });

beforeAll(async () => {
  tenantId = (await owner.tenant.create({ data: { name: `CI 滿意度交易 ${stamp}` } })).id;
  channelId = (await owner.channel.create({
    data: { tenantId, channelType: 'LINE', displayName: `CI ${stamp}`, credentialsEncrypted: encryptCredentials({ channelAccessToken: 'x', channelSecret: 'y' }) },
  })).id;
  contactId = (await owner.contact.create({ data: { tenantId, displayName: `${stamp}-甲` } })).id;
  await owner.channelIdentity.create({ data: { contactId, channelId, channelType: 'LINE', uid: `U${stamp}` } });
});

afterEach(async () => {
  await dropTriggers();
  pushes.length = 0;
  sent.length = 0;
});

afterAll(async () => {
  await dropTriggers();
  await owner.outbox.deleteMany({ where: { tenantId } });
  await owner.notification.deleteMany({ where: { tenantId } });
  await owner.message.deleteMany({ where: { conversation: { tenantId } } });
  await owner.conversation.deleteMany({ where: { tenantId } });
  await owner.caseEvent.deleteMany({ where: { case: { tenantId } } });
  await owner.case.deleteMany({ where: { tenantId } });
  await owner.channelIdentity.deleteMany({ where: { channelId } });
  await owner.contact.deleteMany({ where: { tenantId } });
  await owner.channel.deleteMany({ where: { tenantId } });
  await owner.tenantSettings.deleteMany({ where: { tenantId } });
  await owner.tenant.deleteMany({ where: { id: tenantId } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe('每次解決最多寄出一份滿意度問卷', () => {
  it('認領之後建立問卷訊息失敗', async () => {
    const { caseId, conversationId } = await makeCase('問卷訊息寫入失敗');
    await failWhen('messages', 'survey', `NEW."conversationId" = '${conversationId}'::uuid`);

    await sendSurvey(caseId).catch(() => undefined);

    const row = await owner.case.findUniqueOrThrow({ where: { id: caseId } });
    assert.equal(row.csatSentAt, null, '寄出時間與問卷訊息一起 rollback');
    assert.equal(await owner.message.count({ where: { conversationId } }), 0);
    assert.equal(sent.length, 0, '沒有呼叫渠道外掛');

    // 之後的執行可以再寄出這份問卷
    await dropTriggers();
    await sendSurvey(caseId);
    assert.ok((await owner.case.findUniqueOrThrow({ where: { id: caseId } })).csatSentAt);
    assert.equal(await owner.message.count({ where: { conversationId, contentType: 'csat' } }), 1);
    assert.equal(sent.length, 1);
  });
});

describe('記分的寫入一起成功或一起失敗', () => {
  it('結案寫入失敗時分數也不留下', async () => {
    const { caseId, conversationId } = await makeCase('結案寫入失敗', 'RESOLVED', { csatSentAt: new Date() });
    await failWhen('cases', 'close', `NEW.id = '${caseId}'::uuid AND NEW.status = 'CLOSED'`);

    await rate(caseId, 4).catch(() => undefined);

    const row = await owner.case.findUniqueOrThrow({ where: { id: caseId } });
    assert.equal(row.status, 'RESOLVED');
    assert.equal(row.csatScore, null, '分數一起 rollback');
    assert.equal(await owner.message.count({ where: { conversationId, contentType: 'text' } }), 0, '沒有感謝訊息');
    assert.equal(await owner.caseEvent.count({ where: { caseId, eventType: 'csat_rated' } }), 0);
    assert.equal(await outboxCaseClosed(caseId), 0, '沒有發布 case.closed');
    assert.deepEqual(pushes.filter((p) => p.event === 'message.new' || p.event === 'case.updated'), [], '收件匣沒有收到推送');
    assert.equal(sent.length, 0, '客人的渠道沒有收到感謝訊息');
  });

  it('評分沒有寫入之後可以再評分', async () => {
    const { caseId } = await makeCase('再評分', 'RESOLVED', { csatSentAt: new Date() });
    await failWhen('cases', 'retry', `NEW.id = '${caseId}'::uuid AND NEW.status = 'CLOSED'`);
    await rate(caseId, 2).catch(() => undefined);
    await dropTriggers();

    await rate(caseId, 5);

    const row = await owner.case.findUniqueOrThrow({ where: { id: caseId } });
    assert.equal(row.status, 'CLOSED');
    assert.equal(row.csatScore, 5);
  });
});

describe('從路由記分時，conversation 的函式用綁定租戶的連線', () => {
  it('客服代評後關閉對話', async () => {
    const { caseId, conversationId } = await makeCase('路由代評');
    // 路由傳 tenantScopedClient(fastify.prisma, tenantId)（case.routes.ts）。app_tenant 的基礎連線沒有綁定租戶，RLS 讓查詢查不到對話
    const routeDeps: CsatFlowDeps = { prisma, io, events, conversationDb: tenantScopedClient(prisma, tenantId) };

    assert.equal(await recordCsatScoreFlow(routeDeps, { caseId, score: 4, scope: { tenantId, agentId: undefined } }), true);

    assert.equal((await owner.case.findUniqueOrThrow({ where: { id: caseId } })).status, 'CLOSED');
    assert.equal((await owner.conversation.findUniqueOrThrow({ where: { id: conversationId } })).status, 'CLOSED');
  });
});

describe('問卷逾時結案', () => {
  it('case.closed 寫進 outbox，與工單改成 CLOSED 一起 commit', async () => {
    const sentLongAgo = new Date(Date.now() - 80 * 60 * 60 * 1000);
    const { caseId } = await makeCase('逾時結案', 'RESOLVED', { csatSentAt: sentLongAgo });

    await runAutoClose(caseId);

    assert.equal((await owner.case.findUniqueOrThrow({ where: { id: caseId } })).status, 'CLOSED');
    assert.equal(await outboxCaseClosed(caseId), 1);
  });
});
