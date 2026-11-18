/**
 * 停用租戶的排程群發（issue #410，AUDIT AUTH-11；change stop-disabled-tenant-activity-410）。
 *
 * 租戶停用（含試用到期）之後，排程器到期的群發與 coupon-broadcast 佇列的附券群發都不送出，
 * 群發標為失敗並寫 failureCode = TENANT_DISABLED 與中文原因，不保留 scheduled
 * （避免重新啟用後突然送出過期內容）。
 *
 * 本檔自建租戶（不動共用的 TENANT_A，避免影響同時執行的測試檔），建立與清理資料用 owner 連線，
 * 發送引擎以 app_tenant 連線執行；渠道外掛換成記錄用的替身。afterAll 刪除本檔建立的租戶與資料。
 */
import { redis } from '@open333crm/core';
import assert from 'node:assert/strict';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { registerChannelPlugin, type ChannelPlugin, type OutboundPayload } from '@open333crm/channel-plugins';
import { loadEnvConfig } from '#src/config/env.js';
import { withTenant } from '#src/lib/tenant-db.js';
import { encryptCredentials } from '#src/modules/channel/channel.service.js';
import { createCoupon } from '#src/modules/coupon/coupon.service.js';
import { changeStatus } from '#src/modules/coupon/coupon-lifecycle.service.js';
import { setupBroadcastScheduler } from '#src/modules/marketing/broadcast.scheduler.js';
import { createBroadcast } from '#src/modules/marketing/marketing.service.js';
import { createBroadcastJobRunner } from '#src/modules/marketing/broadcast-coupon.worker.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';
import { ctxOf, runInTenant, testIo } from '#tests/support/tenant-run.js';
import { ALL_CHANNELS } from '#src/services/channel-visibility.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const MARK = `bc-off-${Date.now().toString(36)}`;
const WEB = 'https://crm.example.com';

const sent: Array<{ to: string; payload: OutboundPayload }> = [];
registerChannelPlugin({
  channelType: 'LINE',
  verifySignature: () => true,
  parseWebhook: async () => [],
  getProfile: async (uid: string) => ({ uid, displayName: uid }),
  sendMessage: async (to: string, payload: OutboundPayload) => {
    sent.push({ to, payload });
    return { success: true, channelMsgId: `m-${sent.length}` };
  },
} as unknown as ChannelPlugin);

const store = memBindingStore();

let T = '';
let lineChannel = '';
let materialId = '';
let agentId = '';
let roleId = '';
let contactId = '';

beforeAll(async () => {
  T = (await owner.tenant.create({ data: { name: `CI 停用租戶群發 ${MARK}` } })).id;
  lineChannel = (await owner.channel.create({
    data: { tenantId: T, channelType: 'LINE', displayName: `${MARK}-LINE`, credentialsEncrypted: encryptCredentials({ channelAccessToken: 'x' }), isActive: true },
  })).id;
  roleId = (await owner.role.create({
    data: {
      tenantId: T, slug: `${MARK}-broadcaster`, name: `${MARK}-broadcaster`,
      permissions: { create: ['marketing.view', 'marketing.manage', 'marketing.broadcast', 'channel.view_all', 'coupon.view', 'coupon.issue'].map((permissionCode) => ({ permissionCode })) },
    },
  })).id;
  agentId = (await owner.agent.create({
    data: { tenantId: T, email: `${MARK}@example.com`, name: '群發成員', passwordHash: 'x', roleId },
  })).id;
  materialId = (await owner.material.create({
    data: { tenantId: T, name: `${MARK}-素材`, channelType: 'line', contentType: 'text', body: { text: '秋季優惠' }, createdById: agentId },
  })).id;
  contactId = (await owner.contact.create({ data: { tenantId: T, displayName: `${MARK}-甲` } })).id;
  await owner.channelIdentity.create({ data: { contactId, channelId: lineChannel, channelType: 'LINE', uid: `${MARK}-uid`, profileName: '甲' } });
  await owner.conversation.create({ data: { tenantId: T, contactId, channelId: lineChannel, channelType: 'LINE' } });
});

beforeEach(async () => {
  sent.length = 0;
  await owner.tenant.update({ where: { id: T }, data: { isActive: true } });
});

afterAll(async () => {
  const broadcastIds = (await owner.broadcast.findMany({ where: { tenantId: T }, select: { id: true } })).map((b) => b.id);
  await owner.broadcastRecipient.deleteMany({ where: { broadcastId: { in: broadcastIds } } });
  await owner.broadcastDeliveryAttempt.deleteMany({ where: { broadcastId: { in: broadcastIds } } });
  await owner.$executeRaw`DELETE FROM outbox WHERE "tenantId" = ${T}::uuid`;
  await owner.broadcast.deleteMany({ where: { tenantId: T } });
  await owner.couponInstance.deleteMany({ where: { tenantId: T } });
  await owner.couponCode.deleteMany({ where: { tenantId: T } }).catch(() => undefined);
  await owner.coupon.deleteMany({ where: { tenantId: T } });
  await owner.message.deleteMany({ where: { conversation: { tenantId: T } } });
  await owner.conversation.deleteMany({ where: { tenantId: T } });
  await owner.channelIdentity.deleteMany({ where: { contactId } });
  await owner.contact.deleteMany({ where: { tenantId: T } });
  await owner.shortLink.deleteMany({ where: { tenantId: T } });
  await owner.material.deleteMany({ where: { tenantId: T } });
  await owner.agent.deleteMany({ where: { tenantId: T } });
  await owner.role.deleteMany({ where: { tenantId: T } });
  await owner.channel.deleteMany({ where: { tenantId: T } });
  await owner.tenantSettings.deleteMany({ where: { tenantId: T } });
  await owner.tenant.deleteMany({ where: { id: T } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

async function coupon(name: string) {
  const c = await withTenant(prisma, T, (tx) =>
    createCoupon(ctxOf(tx, T), agentId, {
      name, couponType: 'DISCOUNT_PERCENT', discountPercent: 10, purpose: 'MARKETING',
      validityMode: 'AFTER_CLAIM', afterClaimDays: 30, codeMode: 'UNIQUE_CODE', codePrefix: 'BO',
      redeemMode: 'SELF', perContactLimit: 5,
    } as never));
  assert.ok((await withTenant(prisma, T, (tx) => changeStatus(ctxOf(tx, T), c.id, 'ACTIVE'))).ok);
  return c.id;
}

/** 建立一則到期的排程群發（排定的成員有全部發送權限） */
async function dueBroadcast(name: string, extra: { couponId?: string } = {}) {
  const b = await runInTenant(prisma, T, (ctx) => createBroadcast(ctx.tx, T, agentId, {
    name: `${MARK} ${name}`, channelId: lineChannel, targetType: 'contacts', targetConfig: { contactIds: [contactId] },
    scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
    ...(extra.couponId ? { couponId: extra.couponId } : { materialId }),
  }, ALL_CHANNELS));
  await owner.broadcast.update({ where: { id: b.id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
  return b.id;
}

/** 執行一次排程器，只處理指定的群發（其他測試檔的到期群發不受影響） */
async function pollOnly(broadcastId: string) {
  const scoped = new Proxy(owner, {
    get(target, prop) {
      if (prop !== 'broadcast') return Reflect.get(target, prop);
      return new Proxy(target.broadcast, {
        get(model, key) {
          if (key === 'findMany') {
            return (args: { where: Record<string, unknown> }) => model.findMany({ ...args, where: { ...args.where, id: broadcastId } });
          }
          return Reflect.get(model, key);
        },
      });
    },
  }) as PrismaClient;
  let poll: (() => Promise<void>) | null = null;
  setupBroadcastScheduler(
    { registerSchedule: (s: { run: () => Promise<void> }) => { poll = s.run; } } as never,
    scoped,
    testIo as never,
    redis,
    { prisma, store, webBaseUrl: WEB, visibilityOf: async () => ALL_CHANNELS },
  );
  assert.ok(poll);
  await poll!();
  return owner.broadcast.findFirst({ where: { id: broadcastId } });
}

const disable = () => owner.tenant.update({ where: { id: T }, data: { isActive: false } });

describe('The Scheduler Does Not Send Broadcasts Of A Disabled Tenant', () => {
  it('Active tenant sends the due broadcast (control)', async () => {
    const id = await dueBroadcast('啟用中');
    const row = await pollOnly(id);
    assert.equal(row?.status, 'completed', row?.failureReason ?? '');
    assert.ok(sent.length > 0, '有送出訊息');
  });

  it('Due broadcast of a disabled tenant', async () => {
    const id = await dueBroadcast('停用');
    await disable();
    const row = await pollOnly(id);
    assert.equal(sent.length, 0, '沒有送出任何訊息');
    assert.equal(row?.status, 'failed');
    assert.equal(row?.failureCode, 'TENANT_DISABLED');
    assert.match(row?.failureReason ?? '', /租戶已停用/);
  });

  it('Due coupon broadcast of a disabled tenant', async () => {
    const couponId = await coupon(`${MARK}券1`);
    const id = await dueBroadcast('附券停用', { couponId });
    await disable();
    const row = await pollOnly(id);
    assert.equal(row?.status, 'failed');
    assert.equal(row?.failureCode, 'TENANT_DISABLED');
    assert.equal(sent.length, 0, '沒有送出任何訊息');
    assert.equal(await owner.couponInstance.count({ where: { tenantId: T, couponId } }), 0, '沒有發出任何券');
  });

  it('Queued coupon broadcast job of a disabled tenant', async () => {
    const couponId = await coupon(`${MARK}券2`);
    const id = await dueBroadcast('佇列停用', { couponId });
    await disable();
    const result = await createBroadcastJobRunner({ prisma, adminPrisma: owner, redis, store, webBaseUrl: WEB, visibilityOf: async () => ALL_CHANNELS })(T, id);
    const row = await owner.broadcast.findFirst({ where: { id } });
    assert.equal(row?.status, 'failed', JSON.stringify(result));
    assert.equal(row?.failureCode, 'TENANT_DISABLED');
    assert.equal(await owner.couponInstance.count({ where: { tenantId: T, couponId } }), 0, '沒有發出任何券');
  });
});
