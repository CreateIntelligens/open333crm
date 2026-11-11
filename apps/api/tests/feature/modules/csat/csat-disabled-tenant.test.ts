/**
 * 停用租戶不寄出滿意度問卷（issue #410；change stop-disabled-tenant-activity-410）。
 *
 * 租戶停用（含試用到期）之後，寄送問卷的排程不處理該租戶的工單：不寫 csatSentAt、不建立問卷訊息。
 * 走真實的排程與 sendCsatSurvey，owner 連線（與正式環境的 prismaAdmin 相同不受 RLS 限制）。
 * 排程的查詢只限本檔的工單，避免處理其他測試檔的資料。本檔建立的租戶與資料於 afterAll 刪除。
 * 工單用 LINE 對話：非 LINE 渠道本來就不寄問卷（issue #339 決定 7），用它就測不到租戶停用的條件。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { linePlugin, registerChannelPlugin } from '@open333crm/channel-plugins';
import { loadEnvConfig } from '#src/config/env.js';
import { setupCsatScheduler } from '#src/modules/csat/csat.scheduler.js';

loadEnvConfig();
const owner = new PrismaClient();
const stamp = `csat-off-${Date.now().toString(36)}`;
const io = { to: () => ({ emit: () => undefined }) } as never;
// 不呼叫 LINE：沿用真的問卷版型，只替換送出
registerChannelPlugin({
  ...linePlugin,
  channelType: 'LINE',
  buildCsatSurvey: linePlugin.buildCsatSurvey,
  sendMessage: async () => ({ success: true }),
} as never);

let tenantId = '';
let channelId = '';
let caseId = '';
let conversationId = '';

beforeAll(async () => {
  tenantId = (await owner.tenant.create({ data: { name: `CI 停用租戶問卷 ${stamp}`, isActive: false } })).id;
  channelId = (await owner.channel.create({
    data: { tenantId, channelType: 'LINE', displayName: `CI ${stamp}`, credentialsEncrypted: 'x' },
  })).id;
  const contact = await owner.contact.create({ data: { tenantId, displayName: `${stamp}-甲` } });
  const resolvedAt = new Date(Date.now() - 60 * 60 * 1000);
  caseId = (await owner.case.create({
    data: { tenantId, contactId: contact.id, channelId, title: '冷氣不冷', status: 'RESOLVED', resolvedAt },
  })).id;
  conversationId = (await owner.conversation.create({
    data: { tenantId, contactId: contact.id, channelId, channelType: 'LINE', caseId },
  })).id;
});

afterAll(async () => {
  await owner.message.deleteMany({ where: { conversationId } });
  await owner.conversation.deleteMany({ where: { tenantId } });
  await owner.case.deleteMany({ where: { tenantId } });
  await owner.contact.deleteMany({ where: { tenantId } });
  await owner.channel.deleteMany({ where: { tenantId } });
  await owner.tenantSettings.deleteMany({ where: { tenantId } });
  await owner.tenant.deleteMany({ where: { id: tenantId } });
  await owner.$disconnect();
});

/** 執行一次寄送問卷的排程，查詢只限本檔的工單 */
async function pollSendOnly() {
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
  await runs.get('csat-send')!();
}

describe('停用租戶不寄出滿意度問卷', () => {
  it('停用租戶的工單到了寄送時間', async () => {
    await pollSendOnly();
    const row = await owner.case.findUnique({ where: { id: caseId } });
    assert.equal(row?.csatSentAt, null, '沒有寫入寄出時間');
    assert.equal(await owner.message.count({ where: { conversationId } }), 0, '沒有建立問卷訊息');
  });
});
