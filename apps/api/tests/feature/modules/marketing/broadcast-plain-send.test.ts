/**
 * 一般群發（不附券）的背景發送、訊息額度、收件人失敗原因與排程（issue #362，change fix-plain-broadcast-send-362）。
 *
 * 修正前：
 * - 「立即發送」在 HTTP 請求內同步送完整份名單，回 200 與發送結果。
 * - 一般群發不查訊息額度，額度不足時照樣送。
 * - 收件人送不出時只寫 deliveryStatus = failed，沒有原因。
 * - 排程器以 prismaAdmin（BYPASSRLS）直接執行 executeBroadcast()。
 *
 * 走真的入口：HTTP 路由（marketing.routes）、佇列 job 的執行函式（index.ts 的 coupon-broadcast 佇列同一個組法）、排程器。
 * 本檔自建租戶（不動共用的 TENANT_A），建立與清理資料用 owner 連線，發送以 app_tenant 連線執行；
 * 渠道外掛換成記錄用的替身。afterAll 刪除本檔建立的租戶與資料。
 */
import { redis } from '@open333crm/core';
import assert from 'node:assert/strict';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { registerChannelPlugin, type ChannelPlugin, type OutboundPayload } from '@open333crm/channel-plugins';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import { encryptCredentials } from '#src/modules/channel/channel.service.js';
import marketingRoutes from '#src/modules/marketing/marketing.routes.js';
import { setupBroadcastScheduler } from '#src/modules/marketing/broadcast.scheduler.js';
import { createBroadcast } from '#src/modules/marketing/marketing.service.js';
import { createBroadcastJobRunner } from '#src/modules/marketing/broadcast-coupon.worker.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';
import { runInTenant, testIo } from '#tests/support/tenant-run.js';
import { ALL_CHANNELS } from '#src/services/channel-visibility.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const MARK = `bc-plain-${Date.now().toString(36)}`;
const WEB = 'https://crm.example.com';

// ── 渠道外掛替身 ─────────────────────────────────────────────────────────

const sent: Array<{ to: string; payload: OutboundPayload }> = [];
/** 每個測試可調整：送不出的 uid、multicast 整批失敗、額度查詢的結果 */
const plugin = {
  failUids: new Set<string>(),
  failMulticast: false,
  quota: null as null | 'throw' | { totalUsage: number; maxMessages?: number },
};
registerChannelPlugin({
  channelType: 'LINE',
  verifySignature: () => true,
  parseWebhook: async () => [],
  getProfile: async (uid: string) => ({ uid, displayName: uid }),
  sendMessage: async (to: string, payload: OutboundPayload) => {
    const content = payload.content as { strategy?: string; recipientUids?: string[] };
    if (content.strategy === 'multicast') {
      if (plugin.failMulticast) return { success: false, error: 'multicast rejected' };
      for (const uid of content.recipientUids ?? []) sent.push({ to: uid, payload });
      return { success: true, channelMsgId: `mc-${sent.length}` };
    }
    if (plugin.failUids.has(to)) return { success: false, error: `blocked ${to}` };
    sent.push({ to, payload });
    return { success: true, channelMsgId: `m-${sent.length}` };
  },
  extensions: {
    analytics: {
      getMessageQuota: async () => {
        if (plugin.quota === 'throw') throw new Error('quota api down');
        return plugin.quota ?? { totalUsage: 0 };
      },
    },
  },
} as unknown as ChannelPlugin);

const store = memBindingStore();

// ── 資料 ────────────────────────────────────────────────────────────────

let T = '';
let lineChannel = '';
let webchatChannel = '';
let plainMaterial = '';
let personalMaterial = '';
let webchatMaterial = '';
let agentId = '';
let roleId = '';
let noBroadcastRoleId = '';
const contacts: Array<{ id: string; uid: string }> = [];
/** 在 LINE 渠道沒有身分的聯絡人：受眾解析不到任何人 */
let noIdentityContact = '';

beforeAll(async () => {
  T = (await owner.tenant.create({ data: { name: `CI 一般群發 ${MARK}` } })).id;
  const credentialsEncrypted = encryptCredentials({ channelAccessToken: 'x' });
  lineChannel = (await owner.channel.create({
    data: { tenantId: T, channelType: 'LINE', displayName: `${MARK}-LINE`, credentialsEncrypted, isActive: true },
  })).id;
  webchatChannel = (await owner.channel.create({
    data: { tenantId: T, channelType: 'WEBCHAT', displayName: `${MARK}-WEB`, credentialsEncrypted, isActive: true },
  })).id;
  roleId = (await owner.role.create({
    data: {
      tenantId: T, slug: `${MARK}-broadcaster`, name: `${MARK}-broadcaster`,
      permissions: { create: ['marketing.view', 'marketing.manage', 'marketing.broadcast', 'channel.view_all'].map((permissionCode) => ({ permissionCode })) },
    },
  })).id;
  noBroadcastRoleId = (await owner.role.create({
    data: {
      tenantId: T, slug: `${MARK}-manager`, name: `${MARK}-manager`,
      permissions: { create: ['marketing.view', 'marketing.manage', 'channel.view_all'].map((permissionCode) => ({ permissionCode })) },
    },
  })).id;
  agentId = (await owner.agent.create({
    data: { tenantId: T, email: `${MARK}@example.com`, name: '群發成員', passwordHash: 'x', roleId },
  })).id;
  plainMaterial = (await owner.material.create({
    data: { tenantId: T, name: `${MARK}-素材`, channelType: 'line', contentType: 'text', body: { text: '週年慶' }, createdById: agentId },
  })).id;
  personalMaterial = (await owner.material.create({
    data: { tenantId: T, name: `${MARK}-個人化`, channelType: 'line', contentType: 'text', body: { text: '嗨 {{contact.name}}' }, createdById: agentId },
  })).id;
  webchatMaterial = (await owner.material.create({
    data: { tenantId: T, name: `${MARK}-網站`, channelType: 'line', contentType: 'text', body: { text: 'hi' }, createdById: agentId },
  })).id;
  for (const name of ['甲', '乙']) {
    const c = await owner.contact.create({ data: { tenantId: T, displayName: `${MARK}-${name}` } });
    const uid = `${MARK}-uid-${name}`;
    await owner.channelIdentity.create({ data: { contactId: c.id, channelId: lineChannel, channelType: 'LINE', uid, profileName: name } });
    await owner.conversation.create({ data: { tenantId: T, contactId: c.id, channelId: lineChannel, channelType: 'LINE' } });
    contacts.push({ id: c.id, uid });
  }
  noIdentityContact = (await owner.contact.create({ data: { tenantId: T, displayName: `${MARK}-丙` } })).id;
});

beforeEach(async () => {
  sent.length = 0;
  plugin.failUids.clear();
  plugin.failMulticast = false;
  plugin.quota = null;
  await owner.tenant.update({ where: { id: T }, data: { isActive: true } });
  await owner.agent.update({ where: { id: agentId }, data: { roleId, isActive: true } });
});

afterAll(async () => {
  const broadcastIds = (await owner.broadcast.findMany({ where: { tenantId: T }, select: { id: true } })).map((b) => b.id);
  await owner.broadcastRecipient.deleteMany({ where: { broadcastId: { in: broadcastIds } } });
  await owner.broadcastDeliveryAttempt.deleteMany({ where: { broadcastId: { in: broadcastIds } } });
  await owner.$executeRaw`DELETE FROM outbox WHERE "tenantId" = ${T}::uuid`;
  await owner.broadcast.deleteMany({ where: { tenantId: T } });
  await owner.message.deleteMany({ where: { conversation: { tenantId: T } } });
  await owner.conversation.deleteMany({ where: { tenantId: T } });
  await owner.channelIdentity.deleteMany({ where: { contactId: { in: contacts.map((c) => c.id) } } });
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

let app: FastifyInstance;
beforeAll(async () => {
  app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', prisma);
  app.decorate('prismaAdmin', owner);
  app.decorate('io', testIo);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: agentId, tenantId: T, role: 'AGENT', roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(prisma, T);
  });
  await app.register(marketingRoutes, { prefix: '/api/v1/marketing' });
  await app.ready();
});
afterAll(() => app?.close());

const send = (id: string) => app.inject({ method: 'POST', url: `/api/v1/marketing/broadcasts/${id}/send` });
/** 執行佇列 job，與 index.ts 的 coupon-broadcast 佇列相同的組法 */
const runJob = (broadcastId: string) =>
  createBroadcastJobRunner({ prisma, adminPrisma: owner, redis, io: testIo, store, webBaseUrl: WEB, visibilityOf: async () => ALL_CHANNELS })(T, broadcastId);
const row = (id: string) => owner.broadcast.findFirst({ where: { id } });
const recipients = (id: string) => owner.broadcastRecipient.findMany({ where: { broadcastId: id } });
const jobsOf = async (id: string) =>
  (await owner.outbox.findMany({ where: { tenantId: T, kind: 'job', queueName: 'coupon-broadcast' } }))
    .filter((j) => (j.payload as { broadcastId?: string }).broadcastId === id);

/** 建立一般群發草稿；預設送給甲、乙 */
async function draft(name: string, extra: { materialId?: string; channelId?: string; contactIds?: string[] } = {}) {
  const b = await runInTenant(prisma, T, (ctx) => createBroadcast(ctx.tx, T, agentId, {
    name: `${MARK} ${name}`,
    channelId: extra.channelId ?? lineChannel,
    materialId: extra.materialId ?? plainMaterial,
    targetType: 'contacts',
    targetConfig: { contactIds: extra.contactIds ?? contacts.map((c) => c.id) },
  }, ALL_CHANNELS));
  return b.id;
}

/** 按「立即發送」並執行佇列 job */
async function sendNow(id: string) {
  const res = await send(id);
  assert.equal(res.statusCode, 202, res.body);
  await runJob(id);
  return row(id);
}

// ── 立即發送在背景執行 ─────────────────────────────────────────────────────

describe('立即發送的一般群發在背景執行', () => {
  it('立即發送一般群發回 202 並在背景送出', async () => {
    const id = await draft('立即發送');
    const res = await send(id);
    assert.equal(res.statusCode, 202, res.body);
    assert.equal(res.json().data.status, 'scheduled');
    assert.equal(sent.length, 0, 'HTTP 請求內沒有送出訊息');
    const queued = await row(id);
    assert.equal(queued?.scheduledById, agentId, '記錄按下發送的人');
    assert.equal((await jobsOf(id)).length, 1, 'outbox 有一筆 coupon-broadcast job');

    await runJob(id);
    const done = await row(id);
    assert.equal(done?.status, 'completed', done?.failureReason ?? '');
    assert.deepEqual(sent.map((s) => s.to).sort(), contacts.map((c) => c.uid).sort());
  });

  it('背景發送時受眾為空', async () => {
    const id = await draft('受眾為空', { contactIds: [noIdentityContact] });
    const done = await sendNow(id);
    assert.equal(done?.status, 'failed');
    assert.equal(done?.failureCode, 'BROADCAST_NO_RECIPIENTS');
  });

  it('發送失敗後 job 重試不重送', async () => {
    plugin.failMulticast = true;
    const id = await draft('失敗不重送');
    const done = await sendNow(id);
    assert.equal(done?.status, 'failed');
    plugin.failMulticast = false;
    await runJob(id);
    assert.equal(sent.length, 0, 'job 重試沒有送出訊息');
    assert.equal((await row(id))?.status, 'failed');
  });

  it('Retry a failed broadcast：失敗後按重新發送，job 再送一次', async () => {
    plugin.failMulticast = true;
    const id = await draft('重新發送');
    assert.equal((await sendNow(id))?.status, 'failed');
    plugin.failMulticast = false;
    const done = await sendNow(id);
    assert.equal(done?.status, 'completed', done?.failureReason ?? '');
    assert.equal(sent.length, 2);
  });

  it('Send a broadcast that is sending：回 409，不排入 job', async () => {
    const id = await draft('發送中');
    await owner.broadcast.update({ where: { id }, data: { status: 'sending' } });
    const res = await send(id);
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(res.json().error.code, 'BROADCAST_ALREADY_SENDING');
    assert.equal((await jobsOf(id)).length, 0);
    assert.equal(sent.length, 0);
  });

  it('Two send requests at the same time：兩個 job 與排程器都執行，每人只收到一次', async () => {
    const id = await draft('同時發送');
    assert.equal((await send(id)).statusCode, 202);
    assert.equal((await send(id)).statusCode, 202);
    await Promise.all([runJob(id), runJob(id), pollOnly(id)]);
    assert.equal((await row(id))?.status, 'completed');
    assert.equal(sent.length, 2, '甲、乙各一則');
  });

  it('送出網站聊天室的舊一般群發', async () => {
    const id = (await owner.broadcast.create({
      data: { tenantId: T, channelId: webchatChannel, name: `${MARK} 網站舊草稿`, createdById: agentId, materialId: webchatMaterial, targetType: 'all' },
    })).id;
    const res = await send(id);
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(res.json().error.code, 'CHANNEL_PUSH_NOT_SUPPORTED');
    const failed = await row(id);
    assert.equal(failed?.status, 'failed');
    assert.ok(failed?.failureReason, '寫入原因');
    assert.equal((await jobsOf(id)).length, 0, '沒有排入 job');
  });
});

// ── 訊息額度 ─────────────────────────────────────────────────────────────

describe('一般群發發送前檢查訊息額度', () => {
  it('一般群發額度不足', async () => {
    plugin.quota = { totalUsage: 99, maxMessages: 100 };
    const done = await sendNow(await draft('額度不足'));
    assert.equal(sent.length, 0, '沒有送出任何訊息');
    assert.equal(done?.status, 'failed');
    assert.equal(done?.failureCode, 'LINE_QUOTA_INSUFFICIENT');
    assert.match(done?.failureReason ?? '', /1 則/);
    assert.match(done?.failureReason ?? '', /2 人/);
  });

  it('額度查詢失敗', async () => {
    plugin.quota = 'throw';
    const done = await sendNow(await draft('額度查詢失敗'));
    assert.equal(sent.length, 0);
    assert.equal(done?.status, 'failed');
    assert.equal(done?.failureCode, 'LINE_QUOTA_CHECK_FAILED');
  });

  it('額度足夠', async () => {
    plugin.quota = { totalUsage: 90, maxMessages: 100 };
    const done = await sendNow(await draft('額度足夠'));
    assert.equal(done?.status, 'completed', done?.failureReason ?? '');
    assert.equal(sent.length, 2);
  });
});

// ── 收件人的失敗原因 ─────────────────────────────────────────────────────

describe('一般群發記錄每位收件人的失敗原因', () => {
  it('逐人送出時一位收件人失敗', async () => {
    plugin.failUids.add(contacts[1].uid);
    const id = await draft('逐人失敗', { materialId: personalMaterial });
    const done = await sendNow(id);
    assert.equal(done?.status, 'completed', done?.failureReason ?? '');
    const byContact = new Map((await recipients(id)).map((r) => [r.contactId, r]));
    assert.equal(byContact.get(contacts[0].id)?.deliveryStatus, 'sent');
    assert.equal(byContact.get(contacts[0].id)?.skipReason, null);
    assert.equal(byContact.get(contacts[1].id)?.deliveryStatus, 'failed');
    assert.equal(byContact.get(contacts[1].id)?.skipReason, 'DELIVERY_FAILED');

    const res = await app.inject({ method: 'GET', url: `/api/v1/marketing/broadcasts/${id}/recipients?status=failed` });
    assert.equal(res.statusCode, 200, res.body);
    const items = res.json().data as Array<{ contactId: string; reason: string | null }>;
    assert.deepEqual(items.map((i) => [i.contactId, i.reason]), [[contacts[1].id, 'DELIVERY_FAILED']]);
  });

  it('multicast 整批失敗', async () => {
    plugin.failMulticast = true;
    const id = await draft('整批失敗');
    await sendNow(id);
    const rows = await recipients(id);
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.equal(r.deliveryStatus, 'failed');
      assert.equal(r.skipReason, 'DELIVERY_FAILED');
    }
  });

  it('重新發送後成功', async () => {
    plugin.failUids.add(contacts[1].uid);
    const id = await draft('重送成功', { materialId: personalMaterial });
    await sendNow(id);
    plugin.failUids.clear();
    await owner.broadcast.update({ where: { id }, data: { status: 'failed' } });
    await sendNow(id);
    const r = (await recipients(id)).find((x) => x.contactId === contacts[1].id);
    assert.equal(r?.deliveryStatus, 'sent');
    assert.equal(r?.skipReason, null);
  });
});

// ── 排程器與佇列 job 的檢查 ──────────────────────────────────────────────

/**
 * 執行一次排程器，只處理指定的群發。跨租戶的連線（owner）記下廣播、收件紀錄、渠道、素材的讀寫：
 * 這些都要經由綁定租戶的連線，跨租戶的連線只能查到期清單。
 */
const ADMIN_FORBIDDEN_MODELS = new Set(['broadcastRecipient', 'broadcastDeliveryAttempt', 'channel', 'material', 'channelIdentity', 'contact']);
const adminCalls: string[] = [];
async function pollOnly(broadcastId: string) {
  await owner.broadcast.updateMany({ where: { id: broadcastId, status: 'scheduled' }, data: { scheduledAt: new Date(Date.now() - 1000) } });
  const scoped = new Proxy(owner, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (typeof prop !== 'string' || typeof value !== 'object' || value === null) return value;
      return new Proxy(value as object, {
        get(model, key) {
          const fn = Reflect.get(model, key);
          if (typeof fn !== 'function') return fn;
          return (args: { where?: Record<string, unknown> }) => {
            if (prop === 'broadcast' && key === 'findMany') {
              return (fn as (a: unknown) => unknown).call(model, { ...args, where: { ...args?.where, id: broadcastId } });
            }
            if (prop === 'broadcast' || ADMIN_FORBIDDEN_MODELS.has(prop)) adminCalls.push(`${prop}.${String(key)}`);
            return (fn as (a: unknown) => unknown).call(model, args);
          };
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
  return row(broadcastId);
}

describe('排程器以綁定租戶的連線發送且兩期不重疊', () => {
  it('排程器以租戶連線發送一般群發', async () => {
    const id = await draft('排程租戶連線');
    await owner.broadcast.update({ where: { id }, data: { status: 'scheduled', scheduledAt: new Date(Date.now() + 3600_000) } });
    adminCalls.length = 0;
    const done = await pollOnly(id);
    assert.equal(done?.status, 'completed', done?.failureReason ?? '');
    assert.equal(sent.length, 2);
    assert.deepEqual(adminCalls, [], `跨租戶的連線不該讀寫廣播內容：${adminCalls.join(', ')}`);
  });
});

describe('佇列 job 執行一般群發前的檢查', () => {
  it('Sender lost the broadcast permission before the queued plain broadcast job ran', async () => {
    const id = await draft('佇列降權');
    assert.equal((await send(id)).statusCode, 202);
    await owner.agent.update({ where: { id: agentId }, data: { roleId: noBroadcastRoleId } });
    await runJob(id);
    const done = await row(id);
    assert.equal(sent.length, 0, '沒有送出任何訊息');
    assert.equal(done?.status, 'failed');
    assert.equal(done?.failureCode, 'SCHEDULED_SENDER_FORBIDDEN');
  });

  it('Queued plain broadcast job of a disabled tenant', async () => {
    const id = await draft('佇列停用租戶');
    assert.equal((await send(id)).statusCode, 202);
    await owner.tenant.update({ where: { id: T }, data: { isActive: false } });
    await runJob(id);
    const done = await row(id);
    assert.equal(sent.length, 0, '沒有送出任何訊息');
    assert.equal(done?.status, 'failed');
    assert.equal(done?.failureCode, 'TENANT_DISABLED');
  });
});
