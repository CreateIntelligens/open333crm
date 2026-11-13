/**
 * 平台留言自動私訊健康 API（change add-comment-keyword-private-reply tasks 9.2，design D21、D25；
 * spec comment-reply-platform-controls「平台留言自動私訊頁」）。
 *
 * 走真實的 platform.routes 與 comment-reply-health.service（prismaAdmin 跨租戶唯讀），佇列數量注入假的計數。
 * 健康 API 不呼叫 Meta：裝上假 Graph API，斷言沒有任何呼叫。
 * 測試資料庫可能同時有其他測試的渠道，斷言只看本檔租戶的渠道。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { Redis } from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import authPlugin from '#src/plugins/auth.plugin.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import platformRoutes from '#src/modules/platform/platform.routes.js';
import { createCommentReplyFixtures } from '#tests/support/comment-reply-fixtures.js';
import { createCommentReplyRecords } from '#tests/support/comment-reply-records.js';
import { useFakeMetaGraph } from '#tests/support/fake-meta-graph.js';

// 「非平台身分」走真實的 auth.plugin：平台 JWT 要有 secret 才會驗證（沒設時回 503）
process.env.PLATFORM_JWT_SECRET ||= 'test-cr-health-platform-secret';
loadEnvConfig();

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL!);
const fx = createCommentReplyFixtures(prisma);
const rec = createCommentReplyRecords(prisma);
const graph = useFakeMetaGraph();
const stamp = `cr-health-${Date.now()}`;

const platformUser = await prisma.platformUser.create({
  data: { email: `${stamp}@example.test`, name: 'CI 留言私訊健康', passwordHash: 'x' },
});

const QUEUE = { waiting: 4, active: 1, delayed: 2, failed: 3, completed: 9 };
const app = Fastify();
app.decorate('prismaAdmin', prisma as never);
app.decorate('redis', redis as never);
app.decorateRequest('platformUser', null);
app.decorate('authenticatePlatformSuperuser', async (req: FastifyRequest & { platformUser: unknown }) => {
  req.platformUser = { id: platformUser.id, role: 'PLATFORM_SUPERUSER', mustChangePassword: false };
});
await app.register(errorHandlerPlugin);
await app.register(platformRoutes, { prefix: '/api/v1/platform', commentReplyQueueCounts: async () => QUEUE });
await app.ready();

/** 真實認證的 app：租戶 JWT 打平台 API */
const authApp = Fastify();
authApp.decorate('prismaAdmin', prisma as never);
authApp.decorate('redis', redis as never);
await authApp.register(errorHandlerPlugin);
await authApp.register(authPlugin);
await authApp.register(platformRoutes, { prefix: '/api/v1/platform', commentReplyQueueCounts: async () => QUEUE });
await authApp.ready();

afterAll(async () => {
  await app.close();
  await authApp.close();
  await fx.cleanup(rec.cleanup);
  await prisma.platformUser.delete({ where: { id: platformUser.id } });
  await redis.quit();
  await prisma.$disconnect();
});

const tenant = await fx.tenant({ plan: { features: ['comment_reply'] } });
const receiving = await fx.fbChannel(tenant.id, {
  settings: {
    commentReply: {
      receiving: true,
      subscription: { status: 'ok', fields: ['feed'], checkedAt: '2026-11-13T00:00:00.000Z' },
      lastCommentEventAt: '2026-11-13T01:00:00.000Z',
    },
    tokenHealth: { status: 'valid', checkedAt: '2026-11-13T00:00:00.000Z' },
  },
});
const notReceiving = await fx.fbChannel(tenant.id, { settings: { commentReply: { receiving: false } } });
const plain = await fx.fbChannel(tenant.id);

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
const rule = await rec.rule(tenant.id, receiving.id);
await rec.rule(tenant.id, receiving.id, { isActive: false });
const author = await rec.author(tenant.id, receiving.id);
await rec.log(tenant.id, receiving.id, rule.id, author.id, { status: 'SENT', sentAt: hoursAgo(1), createdAt: hoursAgo(1) });
await rec.log(tenant.id, receiving.id, rule.id, author.id, { status: 'SENT', sentAt: hoursAgo(2), createdAt: hoursAgo(2) });
await rec.log(tenant.id, receiving.id, rule.id, author.id, { status: 'FAILED', reasonCode: 'TOKEN_EXPIRED', createdAt: hoursAgo(3) });
await rec.log(tenant.id, receiving.id, rule.id, author.id, { status: 'FAILED', reasonCode: 'TOKEN_EXPIRED', createdAt: hoursAgo(4) });
await rec.log(tenant.id, receiving.id, rule.id, author.id, { status: 'FAILED', reasonCode: 'USER_UNAVAILABLE', createdAt: hoursAgo(5) });
await rec.log(tenant.id, receiving.id, rule.id, author.id, { status: 'PENDING', createdAt: hoursAgo(6) });
// 超過 24 小時的不算
await rec.log(tenant.id, receiving.id, rule.id, author.id, { status: 'SENT', sentAt: hoursAgo(30), createdAt: hoursAgo(30) });

test('健康表只列開啟接收的渠道，且不呼叫 Meta', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/platform/comment-reply/health' });
  assert.equal(res.statusCode, 200, res.body);
  const data = res.json().data;
  const mine = (data.channels as Array<{ channelId: string }>).filter((c) =>
    [receiving.id, notReceiving.id, plain.id].includes(c.channelId),
  );
  assert.deepEqual(mine.map((c) => c.channelId), [receiving.id]);
  assert.equal(graph.recorded.length, 0, '健康 API 不可呼叫 Meta');
});

test('24 小時統計與佇列數量', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/platform/comment-reply/health' });
  const data = res.json().data;
  const ch = data.channels.find((c: { channelId: string }) => c.channelId === receiving.id);
  assert.equal(ch.tenantId, tenant.id);
  assert.equal(ch.tenantName, tenant.name);
  assert.equal(ch.channelType, 'FB');
  assert.equal(ch.appMode, 'platform');
  assert.deepEqual(ch.subscription, { status: 'ok', checkedAt: '2026-11-13T00:00:00.000Z' });
  assert.equal(ch.tokenStatus, 'valid');
  assert.equal(ch.lastCommentEventAt, '2026-11-13T01:00:00.000Z');
  assert.equal(ch.activeRules, 1);
  assert.equal(ch.sent24h, 2);
  assert.equal(ch.failed24h, 3);
  assert.equal(ch.pending24h, 1);
  assert.equal(ch.topFailureReason, 'TOKEN_EXPIRED');

  // 全平台數字含其他測試的資料，只檢查型別與佇列
  assert.equal(typeof data.summary.matched24h, 'number');
  assert.ok(data.summary.matched24h >= 6);
  assert.ok(data.summary.sent24h >= 2);
  assert.equal(typeof data.summary.failureRate24h, 'number');
  assert.deepEqual(data.summary.queue, QUEUE);
  assert.ok(data.summary.oldestPendingAt === null || !Number.isNaN(Date.parse(data.summary.oldestPendingAt)));
});

test('非平台身分：租戶 token 回 401，不回傳資料', async () => {
  const tenantToken = authApp.jwt.sign({ agentId: 'a1', tenantId: tenant.id, role: 'ADMIN', roleId: null, typ: 'access' });
  const res = await authApp.inject({
    method: 'GET',
    url: '/api/v1/platform/comment-reply/health',
    headers: { authorization: `Bearer ${tenantToken}` },
  });
  assert.ok(res.statusCode === 401 || res.statusCode === 403, res.body);
  assert.equal(res.json().data, undefined);
});
