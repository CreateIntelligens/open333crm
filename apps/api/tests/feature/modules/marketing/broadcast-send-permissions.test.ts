/**
 * 群發的發送權限（change require-broadcast-send-permissions；issue #409 MKT-02、MKT-03）。
 *
 * - 建立群發帶排程要 marketing.broadcast，帶券要 coupon.issue；預覽帶券要 coupon.view；立即發送附券群發要 coupon.issue。
 * - 排程器到期送出前，以排定送出的成員「當下」的有效權限重新檢查，不過時標失敗並寫原因。
 *
 * 引擎以 app_tenant 連線執行；建立與清理資料用 owner 連線。渠道外掛換成記錄用的替身。
 * 本檔建立的資料以 MARK 標記，於 afterAll 刪除。
 */
import { redis } from '@open333crm/core';
import assert from 'node:assert/strict';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { registerChannelPlugin, type ChannelPlugin, type OutboundPayload } from '@open333crm/channel-plugins';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient, withTenant } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import { encryptCredentials } from '#src/modules/channel/channel.service.js';
import { createCoupon } from '#src/modules/coupon/coupon.service.js';
import { changeStatus } from '#src/modules/coupon/coupon-lifecycle.service.js';
import marketingRoutes from '#src/modules/marketing/marketing.routes.js';
import { setupBroadcastScheduler } from '#src/modules/marketing/broadcast.scheduler.js';
import { createBroadcast } from '#src/modules/marketing/marketing.service.js';
import { createBatchIssueFlow } from '#src/modules/marketing/broadcast-coupon.flow.js';
import { createBroadcastJobRunner } from '#src/modules/marketing/broadcast-coupon.worker.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';
import { ctxOf, runInTenant, testIo } from '#tests/support/tenant-run.js';
import { TENANT_A } from '#tests/setup/feature-config.js';
import { ALL_CHANNELS } from '#src/services/channel-visibility.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = TENANT_A;
const MARK = `bc-perm-${Date.now().toString(36)}`;
const WEB = 'https://crm.example.com';

// ── 渠道外掛替身 ─────────────────────────────────────────────────────────

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

// ── 資料 ────────────────────────────────────────────────────────────────

let lineChannel = '';
let materialId = '';
let creatorId = '';
let contactId = '';
let contactUid = '';

/** 角色：名稱 → roleId */
const roles: Record<string, string> = {};
/** 成員：名稱 → { id, roleId } */
const agents: Record<string, { id: string; roleId: string }> = {};

const ROLE_PERMS = {
  // 只能管理行銷（建草稿），不能群發、沒有任何優惠券權限
  manageOnly: ['marketing.view', 'marketing.manage', 'channel.view_all'],
  // 能群發，沒有優惠券權限
  broadcastNoCoupon: ['marketing.view', 'marketing.manage', 'marketing.broadcast', 'channel.view_all'],
  // 能群發也能發券
  broadcaster: ['marketing.view', 'marketing.manage', 'marketing.broadcast', 'channel.view_all', 'coupon.view', 'coupon.issue'],
  // 只能發券（券詳情批次發券），不能群發
  issuer: ['marketing.view', 'channel.view_all', 'coupon.view', 'coupon.issue'],
} as const;
type RoleName = keyof typeof ROLE_PERMS;

/** 目前以哪個成員送 HTTP 請求 */
let current: { id: string; roleId: string } = { id: '', roleId: '' };
const as = (name: RoleName) => {
  current = agents[name];
};

async function coupon(name: string) {
  const c = await withTenant(prisma, T, (tx) =>
    createCoupon(ctxOf(tx, T), creatorId, {
      name: name.slice(0, 30), couponType: 'DISCOUNT_PERCENT', discountPercent: 10, purpose: 'MARKETING',
      validityMode: 'AFTER_CLAIM', afterClaimDays: 30, codeMode: 'UNIQUE_CODE', codePrefix: 'BP',
      redeemMode: 'SELF', perContactLimit: 5,
    } as never));
  assert.ok((await withTenant(prisma, T, (tx) => changeStatus(ctxOf(tx, T), c.id, 'ACTIVE'))).ok);
  return c.id;
}

const inOneHour = () => new Date(Date.now() + 3600_000).toISOString();
const audience = () => ({ targetType: 'contacts' as const, targetConfig: { contactIds: [contactId] } });

beforeAll(async () => {
  const credentialsEncrypted = encryptCredentials({ channelAccessToken: 'x' });
  lineChannel = (await owner.channel.create({
    data: { tenantId: T, channelType: 'LINE', displayName: `${MARK}-LINE`, credentialsEncrypted, isActive: true },
  })).id;
  for (const [name, perms] of Object.entries(ROLE_PERMS)) {
    roles[name] = (await owner.role.create({
      data: {
        tenantId: T, slug: `${MARK}-${name}`, name: `${MARK}-${name}`,
        permissions: { create: perms.map((permissionCode) => ({ permissionCode })) },
      },
    })).id;
    const agent = await owner.agent.create({
      data: { tenantId: T, email: `${MARK}-${name}@example.com`, name: `成員${name}`, passwordHash: 'x', roleId: roles[name] },
    });
    agents[name] = { id: agent.id, roleId: roles[name] };
  }
  creatorId = agents.broadcaster.id;
  materialId = (await owner.material.create({
    data: { tenantId: T, name: `${MARK}-素材`, channelType: 'line', contentType: 'text', body: { text: '秋季優惠' }, createdById: creatorId },
  })).id;
  const contact = await owner.contact.create({ data: { tenantId: T, displayName: `${MARK}-甲` } });
  contactId = contact.id;
  contactUid = `${MARK}-uid`;
  await owner.channelIdentity.create({ data: { contactId, channelId: lineChannel, channelType: 'LINE', uid: contactUid, profileName: '甲' } });
  await owner.conversation.create({ data: { tenantId: T, contactId, channelId: lineChannel, channelType: 'LINE' } });
});

beforeEach(async () => {
  sent.length = 0;
  // 每個測試開始時還原成員的角色與啟用狀態（有的測試會降權或停用）
  for (const [name, a] of Object.entries(agents)) {
    await owner.agent.update({ where: { id: a.id }, data: { roleId: roles[name], isActive: true } });
  }
});

afterAll(async () => {
  const broadcasts = await owner.broadcast.findMany({ where: { tenantId: T, channelId: lineChannel }, select: { id: true } });
  const broadcastIds = broadcasts.map((b) => b.id);
  await owner.broadcastRecipient.deleteMany({ where: { broadcastId: { in: broadcastIds } } });
  await owner.broadcastDeliveryAttempt.deleteMany({ where: { broadcastId: { in: broadcastIds } } });
  await owner.$executeRaw`DELETE FROM outbox WHERE "queueName" = 'coupon-broadcast' AND payload->>'broadcastId' = ANY(${broadcastIds}::text[])`;
  await owner.broadcast.deleteMany({ where: { id: { in: broadcastIds } } });
  await owner.couponInstance.deleteMany({ where: { tenantId: T, coupon: { createdById: creatorId } } });
  await owner.coupon.deleteMany({ where: { tenantId: T, createdById: creatorId } });
  await owner.message.deleteMany({ where: { conversation: { contactId } } });
  await owner.conversation.deleteMany({ where: { contactId } });
  await owner.channelIdentity.deleteMany({ where: { contactId } });
  await owner.contact.deleteMany({ where: { id: contactId } });
  await owner.shortLink.deleteMany({ where: { tenantId: T, createdById: { in: Object.values(agents).map((a) => a.id) } } });
  await owner.material.deleteMany({ where: { id: materialId } });
  await owner.agent.deleteMany({ where: { id: { in: Object.values(agents).map((a) => a.id) } } });
  await owner.role.deleteMany({ where: { id: { in: Object.values(roles) } } });
  await owner.channel.deleteMany({ where: { id: lineChannel } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

let app: FastifyInstance;
beforeAll(async () => {
  app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', prisma);
  app.decorate('prismaAdmin', owner);
  app.decorate('io', testIo);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: current.id, tenantId: T, role: 'AGENT', roleId: current.roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(prisma, T);
  });
  await app.register(marketingRoutes, { prefix: '/api/v1/marketing' });
  await app.ready();
});
afterAll(() => app?.close());

const post = (url: string, payload?: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/api/v1/marketing${url}`, payload });
const requiredPermissionOf = (res: { json: () => { error?: { details?: { requiredPermission?: string } } } }) =>
  res.json().error?.details?.requiredPermission;
const countByName = (name: string) => owner.broadcast.count({ where: { tenantId: T, name } });

// ── 建立群發 ─────────────────────────────────────────────────────────────

describe('Scheduling A Broadcast Requires The Broadcast Permission', () => {
  it('Schedule without the broadcast permission', async () => {
    as('manageOnly');
    const name = `${MARK} 排程無權限`;
    const res = await post('/broadcasts', { name, channelId: lineChannel, materialId, ...audience(), scheduledAt: inOneHour() });
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(requiredPermissionOf(res), 'marketing.broadcast');
    assert.match(res.json().error.message, /排程/);
    assert.equal(await countByName(name), 0, '沒有建立群發');
  });

  it('Draft without the broadcast permission', async () => {
    as('manageOnly');
    const res = await post('/broadcasts', { name: `${MARK} 草稿`, channelId: lineChannel, materialId, ...audience() });
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(res.json().data.status, 'draft');
  });

  it('Draft with an empty scheduledAt needs only marketing.manage', async () => {
    as('manageOnly');
    const res = await post('/broadcasts', { name: `${MARK} 空排程`, channelId: lineChannel, materialId, ...audience(), scheduledAt: '' });
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(res.json().data.status, 'draft');
  });

  it('Schedule with the broadcast permission', async () => {
    as('broadcaster');
    const res = await post('/broadcasts', { name: `${MARK} 排程有權限`, channelId: lineChannel, materialId, ...audience(), scheduledAt: inOneHour() });
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(res.json().data.status, 'scheduled');
  });
});

describe('附券廣播需要發券權限', () => {
  it('沒有發券權限建立附券廣播', async () => {
    const couponId = await coupon(`${MARK}券1`);
    as('broadcastNoCoupon');
    const name = `${MARK} 附券無權限`;
    const res = await post('/broadcasts', { name, channelId: lineChannel, couponId, ...audience() });
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(requiredPermissionOf(res), 'coupon.issue');
    assert.match(res.json().error.message, /優惠券/);
    assert.equal(await countByName(name), 0, '沒有建立群發');
  });

  it('有發券權限建立附券廣播', async () => {
    const couponId = await coupon(`${MARK}券2`);
    as('broadcaster');
    const res = await post('/broadcasts', { name: `${MARK} 附券有權限`, channelId: lineChannel, couponId, ...audience() });
    assert.equal(res.statusCode, 201, res.body);
  });

  it('沒有發券權限立即發送附券廣播', async () => {
    const couponId = await coupon(`${MARK}券3`);
    const b = await runInTenant(prisma, T, (ctx) =>
      createBroadcast(ctx.tx, T, agents.broadcaster.id, { name: `${MARK} 立即發送無券權限`, channelId: lineChannel, couponId, ...audience() }, ALL_CHANNELS));
    as('broadcastNoCoupon');
    const res = await post(`/broadcasts/${b.id}/send`);
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(requiredPermissionOf(res), 'coupon.issue');
    const row = await owner.broadcast.findFirst({ where: { id: b.id } });
    assert.equal(row?.status, 'draft', '廣播狀態不變');
    const jobs = await owner.outbox.findMany({ where: { tenantId: T, kind: 'job', queueName: 'coupon-broadcast' } });
    assert.ok(!jobs.some((j) => (j.payload as { broadcastId?: string }).broadcastId === b.id), '沒有排入發送');
    assert.equal(await owner.couponInstance.count({ where: { tenantId: T, couponId } }), 0, '沒有發出任何券');
  });
});

describe('附券廣播的受眾預覽需要檢視優惠券權限', () => {
  it('沒有檢視優惠券權限預覽附券廣播', async () => {
    const couponId = await coupon(`${MARK}券4`);
    as('manageOnly');
    const res = await post('/broadcasts/audience-preview', { channelId: lineChannel, couponId, ...audience() });
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(requiredPermissionOf(res), 'coupon.view');
    assert.equal(res.json().data, undefined, '回應不含剩餘名額');
  });

  it('不附券的預覽', async () => {
    as('manageOnly');
    const res = await post('/broadcasts/audience-preview', { channelId: lineChannel, ...audience() });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().data.matched, 1);
  });
});

// ── 排程器 ───────────────────────────────────────────────────────────────

/** 讓排程只看到這一則群發（同一個測試資料庫可能有其他測試留下的排程群發），並執行一次 */
async function pollOnly(broadcastId: string) {
  await owner.broadcast.updateMany({ where: { id: broadcastId, status: 'scheduled' }, data: { scheduledAt: new Date(Date.now() - 1000) } });
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

/** 以 broadcaster 透過 API 建立排程群發 */
async function scheduled(name: string, extra: Record<string, unknown> = {}) {
  as('broadcaster');
  const res = await post('/broadcasts', {
    name: `${MARK} ${name}`, channelId: lineChannel, ...audience(), scheduledAt: inOneHour(),
    ...(extra.couponId ? {} : { materialId }), ...extra,
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json().data.id as string;
}

describe('The Scheduler Rechecks The Scheduling Member\'s Permissions', () => {
  it('Creator lost the broadcast permission', async () => {
    const id = await scheduled('降權');
    await owner.agent.update({ where: { id: agents.broadcaster.id }, data: { roleId: roles.manageOnly } });
    const row = await pollOnly(id);
    assert.equal(row?.status, 'failed');
    assert.equal(row?.failureCode, 'SCHEDULED_SENDER_FORBIDDEN');
    assert.match(row?.failureReason ?? '', /執行群發/);
    assert.equal(sent.length, 0, '沒有送出任何訊息');
  });

  it('Creator deactivated', async () => {
    const id = await scheduled('停用');
    await owner.agent.update({ where: { id: agents.broadcaster.id }, data: { isActive: false } });
    const row = await pollOnly(id);
    assert.equal(row?.status, 'failed');
    assert.equal(row?.failureCode, 'SCHEDULED_SENDER_INACTIVE');
    assert.match(row?.failureReason ?? '', /停用/);
    assert.equal(sent.length, 0, '沒有送出任何訊息');
  });

  it('Coupon broadcast and the creator lost the coupon permission', async () => {
    const couponId = await coupon(`${MARK}券5`);
    const id = await scheduled('附券降權', { couponId });
    await owner.agent.update({ where: { id: agents.broadcaster.id }, data: { roleId: roles.broadcastNoCoupon } });
    const row = await pollOnly(id);
    assert.equal(row?.status, 'failed');
    assert.equal(row?.failureCode, 'SCHEDULED_SENDER_FORBIDDEN');
    assert.match(row?.failureReason ?? '', /發放優惠券/);
    assert.equal(sent.length, 0, '沒有送出任何訊息');
    assert.equal(await owner.couponInstance.count({ where: { tenantId: T, couponId } }), 0, '沒有發出任何券');
  });

  it('Member with the permissions', async () => {
    const id = await scheduled('有權限');
    const row = await pollOnly(id);
    assert.equal(row?.status, 'completed', row?.failureReason ?? '');
    assert.ok(sent.length > 0, '有送出訊息');
  });

  it('Coupon broadcast sent now by another member', async () => {
    const couponId = await coupon(`${MARK}券6`);
    // 沒有群發權限的成員建立的附券草稿（例如修正前建立的草稿）
    const b = await runInTenant(prisma, T, (ctx) =>
      createBroadcast(ctx.tx, T, agents.manageOnly.id, { name: `${MARK} 他人發送`, channelId: lineChannel, couponId, ...audience() }, ALL_CHANNELS));
    as('broadcaster');
    const res = await post(`/broadcasts/${b.id}/send`);
    assert.equal(res.statusCode, 202, res.body);
    // 佇列 job 沒有執行，由排程器後備送出
    const row = await pollOnly(b.id);
    assert.equal(row?.status, 'completed', row?.failureReason ?? '');
    assert.equal(row?.scheduledById, agents.broadcaster.id, '記錄按下發送的人');
    assert.equal(await owner.couponInstance.count({ where: { tenantId: T, couponId } }), 1);
  });
});

describe('The Queue Job Rechecks The Sending Member\'s Permissions', () => {
  /** 執行佇列 job，與 index.ts 的 coupon-broadcast 佇列相同的組法 */
  const runJob = (broadcastId: string) =>
    createBroadcastJobRunner({ prisma, adminPrisma: owner, redis, store, webBaseUrl: WEB, visibilityOf: async () => ALL_CHANNELS })(T, broadcastId);

  it('Sender lost the coupon permission before the queued job ran', async () => {
    const couponId = await coupon(`${MARK}券8`);
    const b = await runInTenant(prisma, T, (ctx) =>
      createBroadcast(ctx.tx, T, agents.broadcaster.id, { name: `${MARK} 佇列重驗`, channelId: lineChannel, couponId, ...audience() }, ALL_CHANNELS));
    as('broadcaster');
    const res = await post(`/broadcasts/${b.id}/send`);
    assert.equal(res.statusCode, 202, res.body);
    // job 重試或 outbox 延後送出時，成員已經被拿掉發券權限
    await owner.agent.update({ where: { id: agents.broadcaster.id }, data: { roleId: roles.broadcastNoCoupon } });
    await runJob(b.id);
    const row = await owner.broadcast.findFirst({ where: { id: b.id } });
    assert.equal(row?.status, 'failed');
    assert.equal(row?.failureCode, 'SCHEDULED_SENDER_FORBIDDEN');
    assert.equal(await owner.couponInstance.count({ where: { tenantId: T, couponId } }), 0, '沒有發出任何券');
  });

  it('Sender with the permissions', async () => {
    const couponId = await coupon(`${MARK}券9`);
    const b = await runInTenant(prisma, T, (ctx) =>
      createBroadcast(ctx.tx, T, agents.broadcaster.id, { name: `${MARK} 佇列有權限`, channelId: lineChannel, couponId, ...audience() }, ALL_CHANNELS));
    as('broadcaster');
    assert.equal((await post(`/broadcasts/${b.id}/send`)).statusCode, 202);
    await runJob(b.id);
    const row = await owner.broadcast.findFirst({ where: { id: b.id } });
    assert.equal(row?.status, 'completed', row?.failureReason ?? '');
    assert.equal(await owner.couponInstance.count({ where: { tenantId: T, couponId } }), 1);
  });
});

describe('Permissions Needed To Send A Broadcast', () => {
  it('Batch issue needs only the coupon permission', async () => {
    const couponId = await coupon(`${MARK}券7`);
    const created = await createBatchIssueFlow({ prisma }, T, agents.issuer.id, couponId, {
      channelId: lineChannel, targetType: 'contacts', contactIds: [contactId],
    } as never, ALL_CHANNELS);
    const row = await pollOnly(created.broadcastId);
    assert.equal(row?.status, 'completed', row?.failureReason ?? '');
    assert.equal(await owner.couponInstance.count({ where: { tenantId: T, couponId } }), 1);
  });
});
