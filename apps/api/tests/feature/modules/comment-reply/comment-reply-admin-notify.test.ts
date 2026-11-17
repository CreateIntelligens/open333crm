/**
 * 留言私訊健康告警通知租戶管理員（tenantAdminNotifier）：以 admin 連線找出管理員，
 * 再以 app_tenant 連線在綁定該租戶的交易內寫入通知，commit 之後推播。
 * 成員以 MARK 標記，afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantAdminNotifier } from '#src/modules/comment-reply/comment-reply-health.js';
import { recordingIo, type PushRecord } from '#tests/support/tenant-run.js';
import { TENANT_A, TENANT_B } from '#tests/setup/feature-config.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const MARK = `cr-admin-notify-${Date.now().toString(36)}`;
const pushes: PushRecord[] = [];

const ids: Record<'admin' | 'inactiveAdmin' | 'agent' | 'foreignAdmin', string> = { admin: '', inactiveAdmin: '', agent: '', foreignAdmin: '' };

const mkAgent = async (tenantId: string, n: string, role: 'ADMIN' | 'AGENT', isActive = true) =>
  (await owner.agent.create({ data: { tenantId, email: `${MARK}-${n}@example.com`, name: n, passwordHash: 'x', role, isActive } })).id;

beforeAll(async () => {
  ids.admin = await mkAgent(TENANT_A, 'admin', 'ADMIN');
  ids.inactiveAdmin = await mkAgent(TENANT_A, 'inactive-admin', 'ADMIN', false);
  ids.agent = await mkAgent(TENANT_A, 'agent', 'AGENT');
  ids.foreignAdmin = await mkAgent(TENANT_B, 'foreign-admin', 'ADMIN');
});

afterAll(async () => {
  const all = Object.values(ids).filter(Boolean);
  await owner.notification.deleteMany({ where: { agentId: { in: all } } });
  await owner.agent.deleteMany({ where: { id: { in: all } } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

it('只通知該租戶啟用中的管理員，推播送到帶租戶 ID 的成員房間', async () => {
  const notify = tenantAdminNotifier({ admin: owner, prisma, io: recordingIo(pushes) });
  await notify(TENANT_A, `${MARK} 告警`, '留言私訊暫停');

  const rows = await owner.notification.findMany({ where: { title: `${MARK} 告警` }, select: { agentId: true, tenantId: true, type: true } });
  assert.deepEqual(rows, [{ agentId: ids.admin, tenantId: TENANT_A, type: 'comment_reply_alert' }]);
  assert.deepEqual(
    pushes.map((p) => [p.room, p.event]),
    [[`tenant:${TENANT_A}:agent:${ids.admin}`, 'notification.new']],
  );
});
