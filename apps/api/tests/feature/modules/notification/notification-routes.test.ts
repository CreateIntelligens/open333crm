/**
 * 站內通知的 4 條路由（列表、未讀數、單則已讀、全部已讀）。
 *
 * 每位成員只看得到、只改得到自己的通知；租戶 B 的通知不會出現在租戶 A 的成員。
 * 走 app_tenant 連線，所以也實際檢查 RLS。成員以 MARK 標記，afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import notificationRoutes from '#src/modules/notification/notification.routes.js';
import { TENANT_A, TENANT_B } from '#tests/setup/feature-config.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const MARK = `notify-routes-${Date.now().toString(36)}`;

let me = '';
let other = '';
let foreign = '';
let app: FastifyInstance;

const mkAgent = async (tenantId: string, n: string) =>
  (await owner.agent.create({ data: { tenantId, email: `${MARK}-${n}@example.com`, name: n, passwordHash: 'x' } })).id;

const mkNotification = (tenantId: string, agentId: string, n: string, isRead = false) =>
  owner.notification.create({
    data: { tenantId, agentId, type: 'case_assigned', title: `${MARK} ${n}`, body: n, isRead, ...(isRead ? { readAt: new Date() } : {}) },
  });

async function buildApp(agentId: string) {
  const instance = Fastify();
  await instance.register(errorHandlerPlugin);
  instance.decorate('prisma', prisma);
  instance.decorate('authenticate', async (request: FastifyRequest) => {
    // 只設 request.agent：路由經 flow 以 fastify.prisma 開交易，不使用舊的 request.tenantPrisma
    request.agent = { id: agentId, tenantId: TENANT_A, role: 'AGENT', roleId: null } as never;
  });
  await instance.register(notificationRoutes, { prefix: '/api/v1/notifications' });
  await instance.ready();
  return instance;
}

const cleanup = () => owner.notification.deleteMany({ where: { agentId: { in: [me, other, foreign].filter(Boolean) } } });

beforeAll(async () => {
  me = await mkAgent(TENANT_A, 'me');
  other = await mkAgent(TENANT_A, 'other');
  foreign = await mkAgent(TENANT_B, 'foreign');
  app = await buildApp(me);
});

beforeEach(cleanup);

afterAll(async () => {
  await app.close();
  await cleanup();
  await owner.agent.deleteMany({ where: { id: { in: [me, other, foreign] } } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe('GET /notifications', () => {
  it('只列出自己的通知，新的在前，total 是篩選後的總數', async () => {
    await mkNotification(TENANT_A, me, 'old');
    await mkNotification(TENANT_A, me, 'new');
    await mkNotification(TENANT_A, other, 'others');
    await mkNotification(TENANT_B, foreign, 'foreign');

    const res = await app.inject({ method: 'GET', url: '/api/v1/notifications?page=1&limit=20' });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.deepEqual(body.data.map((n: { body: string }) => n.body), ['new', 'old']);
    assert.equal(body.meta.total, 2);
  });

  it('isRead=false 只列出未讀', async () => {
    await mkNotification(TENANT_A, me, 'unread');
    await mkNotification(TENANT_A, me, 'read', true);

    const res = await app.inject({ method: 'GET', url: '/api/v1/notifications?isRead=false' });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json().data.map((n: { body: string }) => n.body), ['unread']);
  });

  it('isRead 不是 true 或 false 時回 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/notifications?isRead=foo' });
    assert.equal(res.statusCode, 400, res.body);
  });

  it('limit 超過 100 時回 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/notifications?limit=101' });
    assert.equal(res.statusCode, 400, res.body);
  });
});

describe('GET /notifications/unread-count', () => {
  it('只算自己的未讀通知', async () => {
    await mkNotification(TENANT_A, me, 'a');
    await mkNotification(TENANT_A, me, 'b');
    await mkNotification(TENANT_A, me, 'read', true);
    await mkNotification(TENANT_A, other, 'others');

    const res = await app.inject({ method: 'GET', url: '/api/v1/notifications/unread-count' });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().data.count, 2);
  });
});

describe('PATCH /notifications/:id/read', () => {
  it('標記自己的通知為已讀', async () => {
    const n = await mkNotification(TENANT_A, me, 'mine');

    const res = await app.inject({ method: 'PATCH', url: `/api/v1/notifications/${n.id}/read` });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().data.isRead, true);
    const row = await owner.notification.findUniqueOrThrow({ where: { id: n.id } });
    assert.equal(row.isRead, true);
    assert.ok(row.readAt);
  });

  it('別的成員的通知回 404，而且不改動', async () => {
    const n = await mkNotification(TENANT_A, other, 'others');

    const res = await app.inject({ method: 'PATCH', url: `/api/v1/notifications/${n.id}/read` });
    assert.equal(res.statusCode, 404, res.body);
    assert.equal((await owner.notification.findUniqueOrThrow({ where: { id: n.id } })).isRead, false);
  });

  it('別的租戶的通知回 404，而且不改動', async () => {
    const n = await mkNotification(TENANT_B, foreign, 'foreign');

    const res = await app.inject({ method: 'PATCH', url: `/api/v1/notifications/${n.id}/read` });
    assert.equal(res.statusCode, 404, res.body);
    assert.equal((await owner.notification.findUniqueOrThrow({ where: { id: n.id } })).isRead, false);
  });

  it(':id 不是 UUID 時回 400', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/v1/notifications/not-a-uuid/read' });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(res.json().error.code, 'VALIDATION_ERROR');
  });
});

describe('POST /notifications/read-all', () => {
  it('只把自己的未讀通知標為已讀，回傳更新的筆數', async () => {
    await mkNotification(TENANT_A, me, 'a');
    await mkNotification(TENANT_A, me, 'b');
    await mkNotification(TENANT_A, me, 'read', true);
    const others = await mkNotification(TENANT_A, other, 'others');

    const res = await app.inject({ method: 'POST', url: '/api/v1/notifications/read-all' });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().data.updated, 2);
    assert.equal(await owner.notification.count({ where: { agentId: me, isRead: false } }), 0);
    assert.equal((await owner.notification.findUniqueOrThrow({ where: { id: others.id } })).isRead, false);
  });
});
