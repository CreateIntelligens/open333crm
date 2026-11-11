/**
 * 工單重新解決時的問卷（issue #339 決定 2，change csat-reresolve-decisions-339，AUDIT CASE-04）。
 *
 * 重開再解決的工單，上一輪問卷寄出超過 72 小時、客人沒回時，問卷逾時結案的排程在一分鐘內就把工單結案。
 * 修正後：沒評分的清掉 csatSentAt 重新寄一份，逾時從重新寄出起算；已評分的保留分數，不再寄、不結案。
 *
 * 走真的 transitionCase() 與 csat.scheduler.ts 的兩個排程，owner 連線（與正式環境排程的 prismaAdmin 相同不受 RLS 限制）。
 * 排程的查詢只限本檔的工單；LINE 外掛換成不呼叫 LINE 的替身。本檔建立的租戶與資料於 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { linePlugin, registerChannelPlugin } from '@open333crm/channel-plugins';
import { loadEnvConfig } from '#src/config/env.js';
import { encryptCredentials } from '#src/modules/channel/channel.service.js';
import { setupCsatScheduler } from '#src/modules/csat/csat.scheduler.js';
import { transitionCase } from '#src/modules/case/case.service.js';
import type { CaseStatus } from '@open333crm/shared';

loadEnvConfig();
const owner = new PrismaClient();
const stamp = `csat-reresolve-${Date.now().toString(36)}`;
const io = { to: () => ({ emit: () => undefined }) } as never;
const HOUR = 60 * 60 * 1000;

const lineSends: string[] = [];
// 不呼叫 LINE：沿用真的外掛（含問卷版型），只替換送出
registerChannelPlugin({
  ...linePlugin,
  channelType: 'LINE',
  buildCsatSurvey: (linePlugin as { buildCsatSurvey?: unknown }).buildCsatSurvey,
  sendMessage: async (to: string) => {
    lineSends.push(to);
    return { success: true, channelMsgId: 'line-msg' };
  },
} as never);

let tenantId = '';
let channelId = '';
let contactId = '';
let agentId = '';
const caseIds: string[] = [];

beforeAll(async () => {
  tenantId = (await owner.tenant.create({ data: { name: `CI 重新解決問卷 ${stamp}` } })).id;
  channelId = (await owner.channel.create({
    data: {
      tenantId,
      channelType: 'LINE',
      displayName: `CI ${stamp}`,
      credentialsEncrypted: encryptCredentials({ channelSecret: 's', channelAccessToken: 't' }),
    },
  })).id;
  contactId = (await owner.contact.create({ data: { tenantId, displayName: `${stamp}-甲` } })).id;
  await owner.channelIdentity.create({ data: { contactId, channelId, channelType: 'LINE', uid: `U${stamp}` } });
  agentId = (await owner.agent.create({
    data: { tenantId, email: `${stamp}@example.test`, name: '王小明', passwordHash: 'x' },
  })).id;
});

afterAll(async () => {
  await owner.message.deleteMany({ where: { conversation: { tenantId } } });
  await owner.conversation.deleteMany({ where: { tenantId } });
  await owner.caseEvent.deleteMany({ where: { caseId: { in: caseIds } } });
  await owner.case.deleteMany({ where: { tenantId } });
  await owner.channelIdentity.deleteMany({ where: { channelId } });
  await owner.contact.deleteMany({ where: { tenantId } });
  await owner.agent.deleteMany({ where: { tenantId } });
  await owner.channel.deleteMany({ where: { tenantId } });
  await owner.tenantSettings.deleteMany({ where: { tenantId } });
  await owner.tenant.deleteMany({ where: { id: tenantId } });
  await owner.$disconnect();
});

/** 建一張有 LINE 對話的工單 */
async function createCase(data: Record<string, unknown>) {
  const kase = await owner.case.create({
    data: { tenantId, contactId, channelId, title: `${stamp} 冷氣不冷`, ...data } as never,
  });
  caseIds.push(kase.id);
  await owner.conversation.create({
    data: { tenantId, contactId, channelId, channelType: 'LINE', caseId: kase.id },
  });
  return kase.id;
}

/** 客服以 API 的狀態轉換依序改狀態 */
async function transition(caseId: string, ...statuses: CaseStatus[]) {
  for (const status of statuses) {
    await owner.$transaction((tx) => transitionCase({ tx, tenantId }, caseId, agentId, status));
  }
}

/** 執行一次排程，查詢只限 caseId */
async function runSchedule(id: 'csat-send' | 'csat-auto-close', caseId: string) {
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
  }) as PrismaClient;
  const runs = new Map<string, () => Promise<void>>();
  setupCsatScheduler({ registerSchedule: (d: { id: string; run: () => Promise<void> }) => runs.set(d.id, d.run) } as never, scoped, io);
  await runs.get(id)!();
}

const surveyCount = (caseId: string) =>
  owner.message.count({ where: { contentType: 'csat', conversation: { caseId } } });

describe('工單重新解決時的問卷', () => {
  it('重新解決的未評分工單不會被立即結案', async () => {
    // 上一輪：問卷 80 小時前寄出、客人沒回，工單已逾時結案
    const caseId = await createCase({
      status: 'CLOSED',
      resolvedAt: new Date(Date.now() - 81 * HOUR),
      closedAt: new Date(Date.now() - 8 * HOUR),
      csatSentAt: new Date(Date.now() - 80 * HOUR),
    });

    await transition(caseId, 'OPEN', 'IN_PROGRESS', 'RESOLVED');
    await runSchedule('csat-auto-close', caseId);

    const row = await owner.case.findUniqueOrThrow({ where: { id: caseId } });
    assert.equal(row.status, 'RESOLVED', '重新解決的工單不應被問卷逾時結案');
    assert.equal(row.csatSentAt, null, '上一輪的寄出時間已清除');
  });

  it('重新解決的未評分工單再寄一份問卷', async () => {
    const caseId = await createCase({
      status: 'RESOLVED',
      resolvedAt: new Date(Date.now() - 10 * HOUR),
      csatSentAt: new Date(Date.now() - 9 * HOUR),
    });

    await transition(caseId, 'IN_PROGRESS', 'RESOLVED');
    // 31 分鐘後：把這次的解決時間往前推，代替等待
    await owner.case.update({ where: { id: caseId }, data: { resolvedAt: new Date(Date.now() - 31 * 60 * 1000) } });
    const sendsBefore = lineSends.length;
    await runSchedule('csat-send', caseId);

    const row = await owner.case.findUniqueOrThrow({ where: { id: caseId } });
    assert.ok(row.csatSentAt, '寫入新的寄出時間');
    assert.ok(row.csatSentAt.getTime() > Date.now() - 60 * 1000, '寄出時間是這一次');
    assert.equal(await surveyCount(caseId), 1, '對話多一則問卷訊息');
    assert.equal(lineSends.length, sendsBefore + 1, '問卷送到 LINE');
  });

  it('重新寄出的問卷逾時從這次起算', async () => {
    const caseId = await createCase({
      status: 'RESOLVED',
      resolvedAt: new Date(Date.now() - 11 * HOUR),
      csatSentAt: new Date(Date.now() - 10 * HOUR),
    });

    await runSchedule('csat-auto-close', caseId);

    const row = await owner.case.findUniqueOrThrow({ where: { id: caseId } });
    assert.equal(row.status, 'RESOLVED');
  });

  it('已評分的工單重新解決不再寄問卷', async () => {
    const sentAt = new Date(Date.now() - 100 * HOUR);
    const respondedAt = new Date(Date.now() - 99 * HOUR);
    const caseId = await createCase({
      status: 'CLOSED',
      resolvedAt: new Date(Date.now() - 101 * HOUR),
      closedAt: respondedAt,
      csatSentAt: sentAt,
      csatRespondedAt: respondedAt,
      csatScore: 4,
    });

    await transition(caseId, 'OPEN', 'IN_PROGRESS', 'RESOLVED');
    await owner.case.update({ where: { id: caseId }, data: { resolvedAt: new Date(Date.now() - 31 * 60 * 1000) } });
    await runSchedule('csat-send', caseId);
    await runSchedule('csat-auto-close', caseId);

    const row = await owner.case.findUniqueOrThrow({ where: { id: caseId } });
    assert.equal(row.csatScore, 4);
    assert.equal(row.csatSentAt?.getTime(), sentAt.getTime());
    assert.equal(row.csatRespondedAt?.getTime(), respondedAt.getTime());
    assert.equal(row.status, 'RESOLVED', '不逾時結案');
    assert.equal(await surveyCount(caseId), 0, '不再寄問卷');
  });

  it('已評分的工單不寄問卷（客服代評時還沒寄過問卷）', async () => {
    const caseId = await createCase({
      status: 'RESOLVED',
      resolvedAt: new Date(Date.now() - 31 * 60 * 1000),
      csatScore: 4,
      csatRespondedAt: new Date(Date.now() - 2 * HOUR),
    });

    await runSchedule('csat-send', caseId);

    const row = await owner.case.findUniqueOrThrow({ where: { id: caseId } });
    assert.equal(row.csatSentAt, null);
    assert.equal(await surveyCount(caseId), 0);
  });
});
