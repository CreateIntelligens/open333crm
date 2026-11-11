/**
 * 滿意度分數只算客人自評（issue #339 決定 8，analytics-reports「滿意度分數只算客人自評」）。
 *
 * 客服代評（csatRatedBy = 'agent'）不計入 CSAT 平均、好評率與客服績效，另外回傳筆數；
 * 沒有來源的舊評分（NULL）視為客人自評。以 owner 連線直接呼叫 service（報表頁、CLI、MCP 共用同一份計算），
 * 資料放在 2001-04-11（UTC）並建立專用租戶，結束時整個刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getAgentPerformance, getCsatReport, getOverviewStats } from '#src/modules/analytics/analytics.service.js';
import { ALL_CHANNELS } from '#src/services/channel-visibility.js';

const owner = new PrismaClient();
const MARK = `ci-csat-source-${Date.now()}`;
const D = new Date('2001-04-11T06:00:00.000Z');
const FROM = new Date('2001-04-10T00:00:00.000Z');
const TO = new Date('2001-04-12T23:59:59.999Z');

let tenantId = '';
let agentId = '';
const ctx = () => ({ tx: owner as never, tenantId });

beforeAll(async () => {
  tenantId = (await owner.tenant.create({ data: { name: MARK } })).id;
  agentId = (await owner.agent.create({
    data: { tenantId, name: '客服甲', email: `${MARK}@example.test`, passwordHash: 'x' },
  })).id;
  const channelId = (await owner.channel.create({
    data: { tenantId, channelType: 'LINE', displayName: MARK, credentialsEncrypted: 'x' },
  })).id;
  const contactId = (await owner.contact.create({ data: { tenantId, displayName: MARK } })).id;
  const kase = (data: { csatScore: number | null; csatRatedBy?: string | null; title: string }) =>
    owner.case.create({
      data: {
        tenantId, contactId, channelId, assigneeId: agentId, status: 'CLOSED',
        createdAt: D, csatSentAt: D, csatRespondedAt: data.csatScore === null ? null : D, ...data,
      } as never,
    });
  // 客人自評 4、舊資料（沒有來源，視為客人自評）2、客服代評 5、沒有評分
  await kase({ title: '客人自評 4', csatScore: 4, csatRatedBy: 'customer' });
  await kase({ title: '舊資料 2', csatScore: 2, csatRatedBy: null });
  await kase({ title: '客服代評 5', csatScore: 5, csatRatedBy: 'agent' });
  await kase({ title: '客服代評 2', csatScore: 2, csatRatedBy: 'agent' });
  await kase({ title: '沒有評分', csatScore: null });
});

afterAll(async () => {
  await owner.case.deleteMany({ where: { tenantId } });
  await owner.contact.deleteMany({ where: { tenantId } });
  await owner.channel.deleteMany({ where: { tenantId } });
  await owner.agent.deleteMany({ where: { tenantId } });
  await owner.tenantSettings.deleteMany({ where: { tenantId } });
  await owner.tenant.deleteMany({ where: { id: tenantId } });
  await owner.$disconnect();
});

describe('滿意度分數只算客人自評', () => {
  it('總覽的平均不含客服代評', async () => {
    const overview = await getOverviewStats(ctx(), ALL_CHANNELS, FROM, TO);
    assert.equal(overview.csatAvg, 3, '只算客人自評 4 與舊資料 2');
    assert.equal(overview.csatPositiveRate, 50);
    assert.equal((overview as { csatAgentRatedCount?: number }).csatAgentRatedCount, 2);
  });

  it('滿意度報告分開客服代評', async () => {
    const report = await getCsatReport(ctx(), ALL_CHANNELS, FROM, TO);
    assert.equal(report.totalSent, 5);
    assert.equal(report.totalResponded, 2, '回覆數只算客人自評');
    assert.equal(report.avgScore, 3);
    assert.equal((report as { agentRatedCount?: number }).agentRatedCount, 2);
    assert.deepEqual(report.lowScoreCases.map((c) => c.title), ['舊資料 2'], '低分工單不含客服代評的 2 分');
  });

  it('客服績效的 CSAT 不含客服代評', async () => {
    const [row] = await getAgentPerformance(ctx(), ALL_CHANNELS, FROM, TO, agentId);
    assert.equal(row.csatAvg, 3);
  });
});
