/**
 * 只對能讓客人點選分數的渠道寄問卷（issue #339 決定 7，csat-survey「只對能讓客人點選分數的渠道寄問卷」
 * 「工單解決 30 分鐘後寄出問卷」，AUDIT CASE-02）。
 *
 * 非 LINE 的工單不寄問卷、停在已解決，也不佔排程每期的名額。走真的 csat.scheduler.ts 與 sendCsatSurvey()，
 * owner 連線（與正式環境排程的 prismaAdmin 相同不受 RLS 限制）。排程的查詢只限本檔的工單；
 * LINE 外掛換成不呼叫 LINE 的替身。本檔建立的租戶與資料於 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { linePlugin, registerChannelPlugin, webchatPlugin } from '@open333crm/channel-plugins';
import { loadEnvConfig } from '#src/config/env.js';
import { encryptCredentials } from '#src/modules/channel/channel.service.js';
import { setupCsatScheduler } from '#src/modules/csat/csat.scheduler.js';

loadEnvConfig();
const owner = new PrismaClient();
const stamp = `csat-cap-${Date.now().toString(36)}`;
const io = { to: () => ({ emit: () => undefined }) } as never;
const MINUTE = 60 * 1000;

const lineSends: string[] = [];
registerChannelPlugin({
  ...linePlugin,
  channelType: 'LINE',
  buildCsatSurvey: linePlugin.buildCsatSurvey,
  sendMessage: async (to: string) => {
    lineSends.push(to);
    return { success: true, channelMsgId: 'line-msg' };
  },
} as never);
registerChannelPlugin(webchatPlugin);

let tenantId = '';
let lineChannelId = '';
let webchatChannelId = '';
let contactId = '';

beforeAll(async () => {
  tenantId = (await owner.tenant.create({ data: { name: `CI 問卷渠道能力 ${stamp}` } })).id;
  const credentialsEncrypted = encryptCredentials({ channelSecret: 's', channelAccessToken: 't' });
  lineChannelId = (await owner.channel.create({
    data: { tenantId, channelType: 'LINE', displayName: `CI LINE ${stamp}`, credentialsEncrypted },
  })).id;
  webchatChannelId = (await owner.channel.create({
    data: { tenantId, channelType: 'WEBCHAT', displayName: `CI 網站 ${stamp}`, credentialsEncrypted },
  })).id;
  contactId = (await owner.contact.create({ data: { tenantId, displayName: `${stamp}-甲` } })).id;
  await owner.channelIdentity.create({ data: { contactId, channelId: lineChannelId, channelType: 'LINE', uid: `U${stamp}` } });
  await owner.channelIdentity.create({ data: { contactId, channelId: webchatChannelId, channelType: 'WEBCHAT', uid: `W${stamp}` } });
});

afterAll(async () => {
  await owner.message.deleteMany({ where: { conversation: { tenantId } } });
  await owner.conversation.deleteMany({ where: { tenantId } });
  await owner.caseEvent.deleteMany({ where: { case: { tenantId } } });
  await owner.case.deleteMany({ where: { tenantId } });
  await owner.channelIdentity.deleteMany({ where: { contactId } });
  await owner.contact.deleteMany({ where: { tenantId } });
  await owner.channel.deleteMany({ where: { tenantId } });
  await owner.tenantSettings.deleteMany({ where: { tenantId } });
  await owner.tenant.deleteMany({ where: { id: tenantId } });
  await owner.$disconnect();
});

async function createCase(channelType: 'LINE' | 'WEBCHAT', data: Record<string, unknown>) {
  const channelId = channelType === 'LINE' ? lineChannelId : webchatChannelId;
  const kase = await owner.case.create({
    data: { tenantId, contactId, channelId, title: `${stamp} ${channelType}`, status: 'RESOLVED', ...data } as never,
  });
  await owner.conversation.create({ data: { tenantId, contactId, channelId, channelType, caseId: kase.id } });
  return kase.id;
}

/** 執行一次排程，查詢只限 caseIds */
async function runSchedule(id: 'csat-send' | 'csat-auto-close', caseIds: string[]) {
  const scoped = new Proxy(owner, {
    get(target, prop) {
      if (prop !== 'case') return Reflect.get(target, prop);
      return new Proxy(target.case, {
        get(model, key) {
          if (key === 'findMany') {
            return (args: { where: Record<string, unknown> }) =>
              model.findMany({ ...args, where: { ...args.where, id: { in: caseIds } } } as never);
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

describe('只對能讓客人點選分數的渠道寄問卷', () => {
  it('非 LINE 渠道的工單不寄問卷', async () => {
    const caseId = await createCase('WEBCHAT', { resolvedAt: new Date(Date.now() - 31 * MINUTE) });

    await runSchedule('csat-send', [caseId]);

    const row = await owner.case.findUniqueOrThrow({ where: { id: caseId } });
    assert.equal(row.csatSentAt, null, '沒有寫入寄出時間');
    assert.equal(await surveyCount(caseId), 0, '對話中沒有問卷訊息');
  });

  it('非 LINE 渠道的工單停在已解決', async () => {
    const caseId = await createCase('WEBCHAT', { resolvedAt: new Date(Date.now() - 80 * 60 * MINUTE) });

    await runSchedule('csat-send', [caseId]);
    await runSchedule('csat-auto-close', [caseId]);

    const row = await owner.case.findUniqueOrThrow({ where: { id: caseId } });
    assert.equal(row.status, 'RESOLVED');
  });

  it('非 LINE 工單不佔排程名額', async () => {
    const webchatIds: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      webchatIds.push(await createCase('WEBCHAT', { resolvedAt: new Date(Date.now() - (120 + i) * MINUTE) }));
    }
    const lineId = await createCase('LINE', { resolvedAt: new Date(Date.now() - 31 * MINUTE) });

    await runSchedule('csat-send', [...webchatIds, lineId]);

    const row = await owner.case.findUniqueOrThrow({ where: { id: lineId } });
    assert.ok(row.csatSentAt, '這一期就寄出 LINE 工單的問卷');
    assert.equal(await surveyCount(lineId), 1);
  });

  it('解決滿 30 分鐘寄出問卷', async () => {
    const caseId = await createCase('LINE', { resolvedAt: new Date(Date.now() - 31 * MINUTE) });
    const sendsBefore = lineSends.length;

    await runSchedule('csat-send', [caseId]);

    const row = await owner.case.findUniqueOrThrow({ where: { id: caseId } });
    assert.ok(row.csatSentAt);
    assert.equal(lineSends.length, sendsBefore + 1);
  });

  it('解決未滿 30 分鐘不寄問卷', async () => {
    const caseId = await createCase('LINE', { resolvedAt: new Date(Date.now() - 29 * MINUTE) });

    await runSchedule('csat-send', [caseId]);

    const row = await owner.case.findUniqueOrThrow({ where: { id: caseId } });
    assert.equal(row.csatSentAt, null);
  });
});
