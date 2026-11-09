/**
 * 站內通知只寫給仍啟用的成員（issue #484；change skip-inactive-notification-recipient-484，
 * spec standalone-worker-runtime「站內通知只寫給仍啟用的成員」）。
 *
 * API 行程直接寫入通知的兩條路徑：createAndDispatch（CSAT 低分、權杖失效）與序號明細背景匯出的通知。
 * 走真實資料庫與 app_tenant 連線：永久刪除的成員會撞 notifications.agentId 外鍵，mock 測不到。
 * 成員以 MARK 標記，afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import { createAndDispatch } from '#src/modules/notification/notification.service.js';
import { notifyExportResult } from '#src/modules/coupon/coupon-export.flow.js';
import { recordingIo, type PushRecord } from '#tests/support/tenant-run.js';
import { TENANT_A } from '#tests/setup/feature-config.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = TENANT_A;
const MARK = `notify-recipient-${Date.now().toString(36)}`;
const pushes: PushRecord[] = [];
const io = recordingIo(pushes);

let active = '';
let inactive = '';
let purged = '';

const mkAgent = async (n: string, isActive = true) =>
  (await owner.agent.create({ data: { tenantId: T, email: `${MARK}-${n}@example.com`, name: n, passwordHash: 'x', isActive } })).id;

const input = (agentId: string) => ({
  tenantId: T,
  agentId,
  type: 'csat_low_score',
  title: 'CSAT 低分警報',
  body: `${MARK} 測試`,
  clickUrl: '/dashboard/cases',
});

const exportNotice = (agentId: string) => ({
  tenantId: T,
  agentId,
  type: 'coupon_export_ready' as const,
  title: '序號明細已可下載',
  body: `${MARK} 匯出`,
});

const countFor = (agentId: string) => owner.notification.count({ where: { tenantId: T, agentId } });
const pushesTo = (agentId: string) => pushes.filter((p) => p.room.endsWith(`agent:${agentId}`) && p.event === 'notification.new');

beforeAll(async () => {
  active = await mkAgent('active');
  inactive = await mkAgent('inactive', false);
  // 模擬 purgeAgent：成員建立後被永久刪除，通知仍帶著他的 ID
  purged = await mkAgent('purged');
  await owner.agent.delete({ where: { id: purged } });
});

beforeEach(async () => {
  pushes.length = 0;
  await owner.notification.deleteMany({ where: { tenantId: T, agentId: { in: [active, inactive] } } });
  await owner.agent.update({ where: { id: inactive }, data: { isActive: false } });
});

afterAll(async () => {
  await owner.notification.deleteMany({ where: { tenantId: T, agentId: { in: [active, inactive] } } });
  await owner.agent.deleteMany({ where: { id: { in: [active, inactive] } } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe('createAndDispatch 只寫給仍啟用的成員', () => {
  it('createAndDispatch 的收件成員已被永久刪除', async () => {
    const result = await createAndDispatch(tenantScopedClient(prisma, T), io, input(purged));
    assert.equal(result, null);
    assert.equal(await countFor(purged), 0);
    assert.equal(pushesTo(purged).length, 0);
  });

  it('createAndDispatch 的收件成員已停用', async () => {
    const result = await createAndDispatch(tenantScopedClient(prisma, T), io, input(inactive));
    assert.equal(result, null);
    assert.equal(await countFor(inactive), 0);
    assert.equal(pushesTo(inactive).length, 0);
  });

  it('createAndDispatch 的收件成員啟用中', async () => {
    const result = await createAndDispatch(tenantScopedClient(prisma, T), io, input(active));
    assert.ok(result);
    assert.equal(result.agentId, active);
    assert.equal(await countFor(active), 1);
    assert.equal(pushesTo(active).length, 1);
  });

  it('重新啟用後不補送', async () => {
    await createAndDispatch(tenantScopedClient(prisma, T), io, input(inactive));
    await owner.agent.update({ where: { id: inactive }, data: { isActive: true } });

    assert.equal(await countFor(inactive), 0);

    // 重新啟用之後的新通知照常寫入
    await createAndDispatch(tenantScopedClient(prisma, T), io, input(inactive));
    assert.equal(await countFor(inactive), 1);
  });
});

describe('序號明細背景匯出的通知只寫給仍啟用的匯出者', () => {
  it('序號明細匯出者已停用', async () => {
    await assert.doesNotReject(notifyExportResult({ prisma, io }, exportNotice(inactive)));
    assert.equal(await countFor(inactive), 0);
    assert.equal(pushesTo(inactive).length, 0);
  });

  it('序號明細匯出者已被永久刪除', async () => {
    await assert.doesNotReject(notifyExportResult({ prisma, io }, exportNotice(purged)));
    assert.equal(await countFor(purged), 0);
    assert.equal(pushesTo(purged).length, 0);
  });

  it('序號明細匯出者啟用中時照常通知', async () => {
    await notifyExportResult({ prisma, io }, exportNotice(active));
    assert.equal(await countFor(active), 1);
    assert.equal(pushesTo(active).length, 1);
  });
});
