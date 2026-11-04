/**
 * 工單狀態轉換的 resolvedAt 與總覽報表的已解決數（issue #417，AUDIT CASE-04）。
 *
 * 走真實的 transitionCaseFlow（app_tenant 連線，RLS 生效）改狀態，再以 getOverviewStats 查總覽：
 * - 直接關閉的工單不算已解決；
 * - 解決後重開的工單不算已解決；
 * - 從已解決轉成已關閉的工單保留解決時間，仍算已解決。
 * 報表只看本檔建立的渠道，不受其他測試資料影響。本檔建立的資料以 MARK 標記，於 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import type { EventPublisher } from '#src/events/outbox-publisher.js';
import type { RequestActor } from '#src/lib/request-actor.js';
import { inTenant } from '#src/lib/tenant-ctx.js';
import { transitionCaseFlow } from '#src/modules/case/case.flow.js';
import { getOverviewStats } from '#src/modules/analytics/analytics.service.js';
import type { CaseStatus } from '@open333crm/shared';
import { TENANT_A } from '#tests/setup/feature-config.js';
import { recordingIo } from '#tests/support/tenant-run.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = TENANT_A;
const MARK = `ci-case-resolved-${Date.now().toString(36)}`;

/** 不送事件：本檔只檢查工單欄位與報表 */
const events: EventPublisher = { write: async () => {}, dispatch: async () => {} };
const deps = { prisma, io: recordingIo([]), events };

const agent = await owner.agent.create({
  data: { tenantId: T, email: `${MARK}@example.test`, name: MARK, passwordHash: 'x', role: 'AGENT' },
});
const channel = await owner.channel.create({
  data: { tenantId: T, channelType: 'WEBCHAT', isActive: true, displayName: MARK, credentialsEncrypted: 'x' },
});
const contact = await owner.contact.create({ data: { tenantId: T, displayName: MARK } });
const actor: RequestActor = { tenantId: T, agentId: agent.id, roleId: null, ip: '127.0.0.1' };

const caseIds: string[] = [];
async function caseThrough(path: CaseStatus[]) {
  const created = await owner.case.create({
    data: { tenantId: T, contactId: contact.id, channelId: channel.id, title: MARK, status: 'OPEN' },
  });
  caseIds.push(created.id);
  for (const status of path) await transitionCaseFlow(deps, actor, created.id, status);
  return owner.case.findUniqueOrThrow({ where: { id: created.id } });
}

afterAll(async () => {
  await owner.caseEvent.deleteMany({ where: { caseId: { in: caseIds } } });
  await owner.case.deleteMany({ where: { id: { in: caseIds } } });
  await owner.contact.deleteMany({ where: { id: contact.id } });
  await owner.channel.deleteMany({ where: { id: channel.id } });
  await owner.agent.deleteMany({ where: { id: agent.id } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

test('直接關閉、重開與解決後關閉：resolvedAt 與總覽的已解決數一致', async () => {
  const from = new Date(Date.now() - 60 * 60_000);

  const closedDirectly = await caseThrough(['CLOSED']);
  const resolved = await caseThrough(['IN_PROGRESS', 'RESOLVED']);
  const reopened = await caseThrough(['IN_PROGRESS', 'RESOLVED', 'IN_PROGRESS']);
  const resolvedThenClosed = await caseThrough(['IN_PROGRESS', 'RESOLVED', 'CLOSED']);
  const closedThenReopened = await caseThrough(['IN_PROGRESS', 'RESOLVED', 'CLOSED', 'OPEN']);

  assert.equal(closedDirectly.resolvedAt, null, '直接關閉不算已解決');
  assert.ok(resolved.resolvedAt instanceof Date);
  assert.equal(reopened.resolvedAt, null, 'RESOLVED → IN_PROGRESS 清除解決時間');
  assert.ok(resolvedThenClosed.resolvedAt instanceof Date, 'RESOLVED → CLOSED 保留解決時間');
  assert.equal(closedThenReopened.resolvedAt, null, 'CLOSED → OPEN 清除解決時間');

  const to = new Date(Date.now() + 60 * 60_000);
  const overview = await inTenant(prisma, T, (scope) => getOverviewStats(scope, new Set([channel.id]), from, to));
  assert.equal(overview.resolvedCases, 2, '只有「已解決」與「解決後關閉」算已解決');
});
