/**
 * 粉絲門戶活動與積分（#337 階段 3 第六批 portal 的回歸測試）。
 *
 * 後台路由走真實的 requirePermission 與 app_tenant 連線（RLS）；粉絲路由以真的 fanToken 認證。
 * 送出活動的事件寫進真的 outbox，commit 後不送進 Redis。舊寫法的 eventBus 以 mock 取代，只記錄呼叫。
 * 每次執行建立兩個專用租戶，結束時整個刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, test, vi } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';

const mocks = vi.hoisted(() => ({ busPublish: vi.fn() }));
vi.mock('#src/events/event-bus.js', () => ({ eventBus: { publish: mocks.busPublish } }));

const { loadEnvConfig } = await import('#src/config/env.js');
const { tenantScopedClient } = await import('#src/lib/tenant-db.js');
const { default: errorHandlerPlugin } = await import('#src/plugins/error-handler.plugin.js');
const { default: portalRoutes } = await import('#src/modules/portal/portal.routes.js');
const { default: portalPublicRoutes } = await import('#src/modules/portal/portal-public.routes.js');
const { signFanToken } = await import('#src/modules/portal/portal-auth.service.js');
const { createOutboxPublisher } = await import('#src/events/outbox-publisher.js');
type EventPublisher = import('#src/events/outbox-publisher.js').EventPublisher;

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const MARK = `ci-portal-flow-${Date.now()}`;

const tenantA = await owner.tenant.create({ data: { name: `${MARK}-a` } });
const tenantB = await owner.tenant.create({ data: { name: `${MARK}-b` } });
const A = tenantA.id;
const B = tenantB.id;

async function makeManager(tenantId: string) {
  const role = await owner.role.create({
    data: {
      tenantId,
      slug: `${MARK}-manager`,
      name: 'manager',
      permissions: { create: [{ permissionCode: 'portal.view' }, { permissionCode: 'portal.manage' }] },
    },
  });
  const agent = await owner.agent.create({
    data: { tenantId, roleId: role.id, email: `${MARK}-${tenantId}@example.test`, name: '活動管理者', passwordHash: 'x' },
  });
  return { id: agent.id, roleId: role.id, tenantId };
}

const managerA = await makeManager(A);
const managerB = await makeManager(B);
const fanA = await owner.contact.create({ data: { tenantId: A, displayName: `${MARK}-粉絲A` } });
const fanA2 = await owner.contact.create({ data: { tenantId: A, displayName: `${MARK}-粉絲A2` } });
const fanA3 = await owner.contact.create({ data: { tenantId: A, displayName: `${MARK}-粉絲A3` } });

/** 寫進真的 outbox，commit 後不送進 Redis */
const outboxOnly: EventPublisher = { write: createOutboxPublisher(tenantDb).write, dispatch: async () => {} };

async function buildApp(agent: { id: string; roleId: string; tenantId: string }, events: EventPublisher = outboxOnly) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', tenantDb);
  app.decorate('prismaAdmin', owner);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: agent.id, tenantId: agent.tenantId, role: 'AGENT', roleId: agent.roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, agent.tenantId);
  });
  await app.register(portalRoutes, { prefix: '/api/v1/portal', events });
  await app.register(portalPublicRoutes, { prefix: '/api/v1/fan', events });
  await app.ready();
  return app;
}

const appA = await buildApp(managerA);
const appB = await buildApp(managerB);

type App = typeof appA;
const admin = (app: App, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url: `/api/v1/portal${url}`, payload });
const fan = (app: App, contactId: string, method: 'GET' | 'POST', url: string, payload?: object) =>
  app.inject({
    method,
    url: `/api/v1/fan${url}`,
    headers: { authorization: `Bearer ${signFanToken(contactId, A)}` },
    payload,
  });

/** 建立並發布一個投票活動，回傳活動與兩個選項 */
async function publishedPoll(settings: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const created = await admin(appA, 'POST', '/activities', {
    type: 'POLL',
    title: `${MARK}-投票`,
    settings,
    options: [{ label: '甲' }, { label: '乙' }],
    ...extra,
  });
  assert.equal(created.statusCode, 200, created.body);
  const activity = created.json().data as { id: string; options: Array<{ id: string; label: string }> };
  const published = await admin(appA, 'POST', `/activities/${activity.id}/publish`);
  assert.equal(published.statusCode, 200, published.body);
  return activity;
}

const submittedEvents = () =>
  owner.outbox.findMany({ where: { tenantId: A, kind: 'event', name: 'portal.activity.submitted' } });

beforeEach(async () => {
  await owner.outbox.deleteMany({ where: { tenantId: A } });
  mocks.busPublish.mockReset();
});

afterAll(async () => {
  await Promise.all([appA.close(), appB.close()]);
  for (const tenantId of [A, B]) {
    await owner.outbox.deleteMany({ where: { tenantId } });
    await owner.pointTransaction.deleteMany({ where: { tenantId } });
    await owner.portalSubmission.deleteMany({ where: { tenantId } });
    await owner.portalActivity.deleteMany({ where: { tenantId } });
    await owner.contact.deleteMany({ where: { tenantId } });
    await owner.agent.deleteMany({ where: { tenantId } });
    await owner.role.deleteMany({ where: { tenantId } });
    await owner.tenant.delete({ where: { id: tenantId } });
  }
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

// ─── 後台：活動 ─────────────────────────────────────────────────────────────

test('活動從建立、編輯、發布、結束到封存與取消封存', async () => {
  const created = await admin(appA, 'POST', '/activities', {
    type: 'QUIZ',
    title: `${MARK}-測驗`,
    options: [{ label: '舊選項' }],
    fields: [{ fieldKey: 'name', label: '姓名' }],
  });
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().data.id as string;
  assert.equal(created.json().data.status, 'DRAFT');

  const patched = await admin(appA, 'PATCH', `/activities/${id}`, {
    title: `${MARK}-測驗（改）`,
    options: [{ label: '新選項一', isCorrect: true }, { label: '新選項二' }],
  });
  assert.equal(patched.statusCode, 200, patched.body);
  assert.deepEqual(
    patched.json().data.options.map((o: { label: string }) => o.label),
    ['新選項一', '新選項二'],
    '編輯時取代全部選項',
  );
  assert.equal(patched.json().data.fields.length, 1, '沒送 fields 時不動欄位');

  const detail = await admin(appA, 'GET', `/activities/${id}`);
  assert.equal(detail.json().data.title, `${MARK}-測驗（改）`);

  assert.equal((await admin(appA, 'POST', `/activities/${id}/publish`)).json().data.status, 'PUBLISHED');
  assert.equal((await admin(appA, 'POST', `/activities/${id}/end`)).json().data.status, 'ENDED');
  assert.equal((await admin(appA, 'POST', `/activities/${id}/archive`)).json().data.status, 'ARCHIVED');

  const listed = await admin(appA, 'GET', '/activities');
  assert.ok(!listed.json().data.some((a: { id: string }) => a.id === id), '預設列表不含已封存的活動');
  const archived = await admin(appA, 'GET', '/activities?status=ARCHIVED');
  assert.ok(archived.json().data.some((a: { id: string }) => a.id === id), '帶 status=ARCHIVED 查得到');

  assert.equal((await admin(appA, 'POST', `/activities/${id}/unarchive`)).json().data.status, 'ENDED');
});

test('狀態不對時的錯誤：編輯、刪除、發布、結束回 400；封存回 409', async () => {
  const activity = await publishedPoll();
  const id = activity.id;

  const patched = await admin(appA, 'PATCH', `/activities/${id}`, { title: 'x' });
  assert.equal(patched.statusCode, 400, patched.body);
  assert.equal(patched.json().error.code, 'BAD_REQUEST');
  assert.equal((await admin(appA, 'DELETE', `/activities/${id}`)).statusCode, 400);
  assert.equal((await admin(appA, 'POST', `/activities/${id}/publish`)).statusCode, 400);

  const archived = await admin(appA, 'POST', `/activities/${id}/archive`);
  assert.equal(archived.statusCode, 409, archived.body);
  assert.equal(archived.json().error.code, 'INVALID_ACTIVITY_STATUS');

  assert.equal((await admin(appA, 'POST', `/activities/${id}/end`)).statusCode, 200);
  assert.equal((await admin(appA, 'POST', `/activities/${id}/end`)).statusCode, 400);
});

test('只有草稿可以刪除，刪除後查不到', async () => {
  const created = await admin(appA, 'POST', '/activities', { type: 'FORM', title: `${MARK}-表單` });
  const id = created.json().data.id as string;
  assert.equal((await admin(appA, 'DELETE', `/activities/${id}`)).statusCode, 200);
  assert.equal((await admin(appA, 'GET', `/activities/${id}`)).statusCode, 404);
});

test('其他租戶的活動回 404', async () => {
  const activity = await publishedPoll();
  for (const [method, url] of [
    ['GET', `/activities/${activity.id}`],
    ['PATCH', `/activities/${activity.id}`],
    ['DELETE', `/activities/${activity.id}`],
    ['POST', `/activities/${activity.id}/end`],
    ['POST', `/activities/${activity.id}/archive`],
  ] as const) {
    const res = await admin(appB, method, url, method === 'PATCH' ? { title: 'x' } : undefined);
    assert.equal(res.statusCode, 404, `${method} ${url}: ${res.body}`);
  }
  const subs = await admin(appB, 'GET', `/activities/${activity.id}/submissions`);
  assert.deepEqual(subs.json().meta.total, 0);
});

test('抽獎只從還沒中獎的作答抽出', async () => {
  const activity = await publishedPoll({ allowMultiple: true });
  for (const contact of [fanA, fanA2, fanA3]) {
    const res = await fan(appA, contact.id, 'POST', `/activities/${activity.id}/submit`, { optionIds: [activity.options[0].id] });
    assert.equal(res.statusCode, 200, res.body);
  }

  const first = await admin(appA, 'POST', `/activities/${activity.id}/draw`, { count: 2 });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().data.length, 2);
  assert.ok(first.json().data.every((w: { isWinner: boolean; contact: { id: string } }) => w.isWinner && w.contact.id));

  const second = await admin(appA, 'POST', `/activities/${activity.id}/draw`, { count: 5 });
  assert.equal(second.json().data.length, 1, '只剩一位沒中獎');
  const firstIds = new Set(first.json().data.map((w: { id: string }) => w.id));
  assert.ok(!firstIds.has(second.json().data[0].id));

  const subs = await admin(appA, 'GET', `/activities/${activity.id}/submissions`);
  assert.equal(subs.json().meta.total, 3);
  assert.equal(subs.json().data.filter((s: { isWinner: boolean }) => s.isWinner).length, 3);

  assert.equal((await admin(appA, 'POST', `/activities/${activity.id}/draw`, { count: 0 })).statusCode, 400);
});

// ─── 後台：積分 ─────────────────────────────────────────────────────────────

test('調整積分累計餘額，其他租戶看不到', async () => {
  const contact = await owner.contact.create({ data: { tenantId: A, displayName: `${MARK}-積分` } });
  assert.equal((await admin(appA, 'POST', '/points/adjust', { contactId: contact.id, amount: 10, note: '加點' })).statusCode, 200);
  const minus = await admin(appA, 'POST', '/points/adjust', { contactId: contact.id, amount: -3 });
  assert.equal(minus.json().data.balance, 7);

  const balance = await admin(appA, 'GET', `/points/balance/${contact.id}`);
  assert.deepEqual(balance.json().data, { contactId: contact.id, balance: 7 });
  const list = await admin(appA, 'GET', `/points?contactId=${contact.id}`);
  assert.deepEqual(list.json().data.map((t: { amount: number }) => t.amount), [-3, 10]);
  assert.equal(list.json().meta.total, 2);

  assert.equal((await admin(appB, 'GET', `/points/balance/${contact.id}`)).json().data.balance, 0);
  assert.equal((await admin(appB, 'GET', `/points?contactId=${contact.id}`)).json().meta.total, 0);
});

// ─── 粉絲門戶 ──────────────────────────────────────────────────────────────

test('粉絲只看得到已發布、已開始、還沒結束的活動', async () => {
  const open = await publishedPoll();
  const future = await publishedPoll({}, { startsAt: new Date(Date.now() + 86_400_000).toISOString() });
  const draft = await admin(appA, 'POST', '/activities', { type: 'POLL', title: `${MARK}-草稿` });

  const res = await fan(appA, fanA.id, 'GET', '/activities');
  assert.equal(res.statusCode, 200, res.body);
  const ids = res.json().data.map((a: { id: string }) => a.id);
  assert.ok(ids.includes(open.id));
  assert.ok(!ids.includes(future.id), '還沒開始的不列出');
  assert.ok(!ids.includes(draft.json().data.id), '草稿不列出');
  assert.ok(
    res.json().data.every((a: { options: Array<Record<string, unknown>> }) => a.options.every((o) => !('isCorrect' in o))),
    '列表不回傳正確答案',
  );

  assert.equal((await fan(appA, fanA.id, 'GET', `/activities/${draft.json().data.id}`)).statusCode, 404);
});

test('粉絲送出活動：記錄作答、給積分、詳情帶出自己的作答', async () => {
  const activity = await publishedPoll({ pointsPerSubmit: 5 });
  const contact = await owner.contact.create({ data: { tenantId: A, displayName: `${MARK}-作答` } });

  const before = await fan(appA, contact.id, 'GET', `/activities/${activity.id}`);
  assert.equal(before.statusCode, 200, before.body);
  assert.equal(before.json().data.mySubmission, null);

  const submitted = await fan(appA, contact.id, 'POST', `/activities/${activity.id}/submit`, {
    optionIds: [activity.options[1].id],
  });
  assert.equal(submitted.statusCode, 200, submitted.body);
  assert.equal(submitted.json().data.pointsEarned, 5);

  const after = await fan(appA, contact.id, 'GET', `/activities/${activity.id}`);
  assert.equal(after.json().data.mySubmission.id, submitted.json().data.id);

  const points = await fan(appA, contact.id, 'GET', '/me/points');
  assert.equal(points.json().data.balance, 5);
  assert.equal(points.json().data.transactions[0].refId, submitted.json().data.id);

  const mine = await fan(appA, contact.id, 'GET', '/me/activities');
  assert.deepEqual(mine.json().data.map((s: { activity: { id: string } }) => s.activity.id), [activity.id]);

  const result = await fan(appA, contact.id, 'GET', `/activities/${activity.id}/result`);
  assert.equal(result.json().data.totalSubmissions, 1);
  assert.deepEqual(result.json().data.options.map((o: { votes: number }) => o.votes), [0, 1]);
});

test('第二次送出被拒絕，不再給積分', async () => {
  const activity = await publishedPoll({ pointsPerSubmit: 2 });
  const contact = await owner.contact.create({ data: { tenantId: A, displayName: `${MARK}-重複` } });
  const url = `/activities/${activity.id}/submit`;
  assert.equal((await fan(appA, contact.id, 'POST', url, { optionIds: [activity.options[0].id] })).statusCode, 200);

  const again = await fan(appA, contact.id, 'POST', url, { optionIds: [activity.options[0].id] });
  assert.equal(again.statusCode, 400, again.body);
  assert.equal(again.json().error.message, '您已參加過這個活動');
  assert.equal((await fan(appA, contact.id, 'GET', '/me/points')).json().data.balance, 2);
});

test('沒有 fanToken 回 401', async () => {
  const res = await appA.inject({ method: 'GET', url: '/api/v1/fan/activities' });
  assert.equal(res.statusCode, 401);
});

// ─── 送出活動的事件（第六批改走 outbox） ──────────────────────────────────

test('送出活動的事件與作答一起寫進 outbox', async () => {
  const activity = await publishedPoll();
  const contact = await owner.contact.create({ data: { tenantId: A, displayName: `${MARK}-事件` } });

  const res = await fan(appA, contact.id, 'POST', `/activities/${activity.id}/submit`, { optionIds: [activity.options[0].id] });
  assert.equal(res.statusCode, 200, res.body);

  const events = await submittedEvents();
  assert.equal(events.length, 1, '事件寫進 outbox');
  assert.deepEqual(events[0].payload, {
    activityId: activity.id,
    contactId: contact.id,
    submissionId: res.json().data.id,
    activityType: 'POLL',
  });
  assert.equal(mocks.busPublish.mock.calls.length, 0, '不再直接送進訂閱者佇列');
});

test('事件寫不進 outbox 時，作答與積分都不留下', async () => {
  const failing: EventPublisher = {
    write: async () => {
      throw new Error('outbox write failed');
    },
    dispatch: async () => {},
  };
  const app = await buildApp(managerA, failing);
  try {
    const activity = await publishedPoll({ pointsPerSubmit: 3 });
    const contact = await owner.contact.create({ data: { tenantId: A, displayName: `${MARK}-失敗` } });

    const res = await fan(app, contact.id, 'POST', `/activities/${activity.id}/submit`, { optionIds: [activity.options[0].id] });
    assert.equal(res.statusCode, 400, res.body);

    assert.equal(await owner.portalSubmission.count({ where: { contactId: contact.id } }), 0, '作答 rollback');
    assert.equal(await owner.pointTransaction.count({ where: { contactId: contact.id } }), 0, '積分 rollback');
  } finally {
    await app.close();
  }
});
