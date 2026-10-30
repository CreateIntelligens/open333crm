/**
 * 自動化規則與快速回覆預設組的路由（#337 階段 3 第八批 automation、quick-reply-preset 搬遷前的回歸測試）。
 *
 * 搬遷前後都要通過。路由走真實的 requirePermission 與 app_tenant 連線（RLS）。
 * 每次執行建立兩個專用租戶，結束時整個刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, describe, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import automationRoutes from '#src/modules/automation/automation.routes.js';
import quickReplyPresetRoutes from '#src/modules/line/quick-reply-preset.routes.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const MARK = `ci-automation-${Date.now()}`;
const MISSING = '00000000-0000-4000-8000-000000000000';

const tenantA = await owner.tenant.create({ data: { name: `${MARK}-a` } });
const tenantB = await owner.tenant.create({ data: { name: `${MARK}-b` } });
const A = tenantA.id;
const B = tenantB.id;

async function makeAgent(
  tenantId: string,
  name = 'manager',
  codes = ['automation.view', 'automation.manage', 'quickreply.manage'],
) {
  const role = await owner.role.create({
    data: {
      tenantId,
      slug: `${MARK}-${name}`,
      name,
      permissions: { create: codes.map((permissionCode) => ({ permissionCode })) },
    },
  });
  const agent = await owner.agent.create({
    data: { tenantId, roleId: role.id, name, email: `${MARK}-${name}-${tenantId}@example.test`, passwordHash: 'x' },
  });
  return { id: agent.id, tenantId, roleId: role.id };
}

async function buildApp(agent: { id: string; tenantId: string; roleId: string }) {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', tenantDb);
  app.decorate('prismaAdmin', owner);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: agent.id, tenantId: agent.tenantId, role: 'ADMIN', roleId: agent.roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, agent.tenantId);
  });
  await app.register(automationRoutes, { prefix: '/api/v1/automation' });
  await app.register(quickReplyPresetRoutes, { prefix: '/api/v1/line/quick-reply-presets' });
  await app.ready();
  return app;
}

const appA = await buildApp(await makeAgent(A));
const appB = await buildApp(await makeAgent(B));
const appInboxOnly = await buildApp(await makeAgent(A, 'inbox-only', ['inbox.view']));
const appViewOnly = await buildApp(await makeAgent(A, 'view-only', ['automation.view']));
type App = typeof appA;

// ── 資料 ──
const material = await owner.material.create({
  data: { tenantId: A, name: `${MARK}-素材`, channelType: 'LINE', contentType: 'text', body: { text: '您好' } },
});
const materialB = await owner.material.create({
  data: { tenantId: B, name: `${MARK}-他租戶素材`, channelType: 'LINE', contentType: 'text', body: { text: '您好' } },
});
const couponOf = (tenantId: string, displayCode: string, createdById: string) =>
  owner.coupon.create({ data: { tenantId, name: `${MARK}-券`, displayCode, status: 'ACTIVE', createdById } });
const coupon = await couponOf(A, `${MARK}-A`, MISSING);
const couponB = await couponOf(B, `${MARK}-B`, MISSING);

afterAll(async () => {
  await Promise.all([appA.close(), appB.close(), appInboxOnly.close(), appViewOnly.close()]);
  for (const tenantId of [A, B]) {
    await owner.quickReplyPreset.deleteMany({ where: { tenantId } });
    await owner.automationLog.deleteMany({ where: { tenantId } });
    await owner.automationRule.deleteMany({ where: { tenantId } });
    await owner.coupon.deleteMany({ where: { tenantId } });
    await owner.material.deleteMany({ where: { tenantId } });
    await owner.agent.deleteMany({ where: { tenantId } });
    await owner.role.deleteMany({ where: { tenantId } });
    await owner.tenant.delete({ where: { id: tenantId } });
  }
  await Promise.all([owner.$disconnect(), tenantDb.$disconnect()]);
});

async function call(app: App, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
  const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }) });
  return { status: res.statusCode, body: res.json() as { data: any; error?: { code: string; message: string } } };
}

const rules = '/api/v1/automation/rules';
const rule = (extra: Record<string, unknown> = {}) => ({
  name: '新規則',
  trigger: { type: 'message.received' },
  conditions: { all: [] },
  actions: [{ type: 'add_tag', params: { tagName: 'VIP' } }],
  ...extra,
});
const followGift = (couponId: string) => ({
  name: '加好友禮',
  trigger: { type: 'contact.followed' },
  conditions: { all: [{ fact: 'follow.isFirst', operator: 'equal', value: true }] },
  actions: [{ type: 'issue_coupon', params: { couponId } }],
});

async function create(app: App, body: Record<string, unknown>) {
  const res = await call(app, 'POST', rules, body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data as { id: string; tenantId: string; isActive: boolean; enabled: boolean; eventType: string };
}

describe('自動化規則', () => {
  test('建立：寫入目前的租戶，eventType 取自觸發', async () => {
    const created = await create(appA, rule({ name: `${MARK}-建立`, priority: 3, isActive: false }));
    assert.equal(created.tenantId, A);
    assert.equal(created.eventType, 'message.received');
    assert.equal(created.isActive, false);
    const row = await owner.automationRule.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(row.priority, 3);
  });

  test('列表：依優先序排序，可依啟用狀態與觸發篩選，不含已刪除與其他租戶', async () => {
    const low = await create(appA, rule({ name: `${MARK}-低`, priority: 1 }));
    const high = await create(appA, rule({ name: `${MARK}-高`, priority: 9, trigger: { type: 'case.created' } }));
    const off = await create(appA, rule({ name: `${MARK}-停用`, priority: 5, isActive: false }));
    const gone = await create(appA, rule({ name: `${MARK}-刪除`, priority: 7 }));
    assert.equal((await call(appA, 'DELETE', `${rules}/${gone.id}`)).status, 200);
    await create(appB, rule({ name: `${MARK}-B` }));

    const all = await call(appA, 'GET', `${rules}?limit=100`);
    assert.equal(all.status, 200);
    const ids = (all.body.data as Array<{ id: string }>).map((r) => r.id);
    assert.ok(ids.indexOf(high.id) < ids.indexOf(off.id) && ids.indexOf(off.id) < ids.indexOf(low.id), '優先序由高到低');
    assert.ok(!ids.includes(gone.id), '不含已刪除');
    assert.ok((all.body.data as Array<{ tenantId: string }>).every((r) => r.tenantId === A), '不含其他租戶');
    assert.equal((all.body as unknown as { meta: { total: number } }).meta.total, ids.length);

    const inactive = await call(appA, 'GET', `${rules}?isActive=false&limit=100`);
    assert.ok((inactive.body.data as Array<{ id: string; isActive: boolean }>).every((r) => !r.isActive));
    assert.ok((inactive.body.data as Array<{ id: string }>).some((r) => r.id === off.id));

    const byTrigger = await call(appA, 'GET', `${rules}?trigger=case.created&limit=100`);
    assert.deepEqual((byTrigger.body.data as Array<{ id: string }>).map((r) => r.id), [high.id]);

    const paged = await call(appA, 'GET', `${rules}?limit=1&page=2`);
    assert.deepEqual((paged.body.data as Array<{ id: string }>).map((r) => r.id), [ids[1]]);
  });

  test('單筆：附最近的執行紀錄；其他租戶與已刪除的規則回 404', async () => {
    const r = await create(appA, rule({ name: `${MARK}-單筆` }));
    await owner.automationLog.create({ data: { tenantId: A, ruleId: r.id, success: true } });
    const got = await call(appA, 'GET', `${rules}/${r.id}`);
    assert.equal(got.status, 200);
    assert.equal(got.body.data.id, r.id);
    assert.equal(got.body.data.logs.length, 1);

    assert.equal((await call(appB, 'GET', `${rules}/${r.id}`)).status, 404);
    assert.equal((await call(appB, 'PATCH', `${rules}/${r.id}`, { name: '改' })).status, 404);
    assert.equal((await call(appB, 'DELETE', `${rules}/${r.id}`)).status, 404);
    assert.equal((await call(appB, 'POST', `${rules}/${r.id}/test`, {})).status, 404);

    assert.equal((await call(appA, 'DELETE', `${rules}/${r.id}`)).status, 200);
    assert.equal((await call(appA, 'GET', `${rules}/${r.id}`)).status, 404);
  });

  test('更新：寫入改動的欄位；已刪除的規則回 404', async () => {
    const r = await create(appA, rule({ name: `${MARK}-更新`, isActive: false }));
    const res = await call(appA, 'PATCH', `${rules}/${r.id}`, { name: `${MARK}-改名`, isActive: true, stopOnMatch: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const row = await owner.automationRule.findUniqueOrThrow({ where: { id: r.id } });
    assert.equal(row.name, `${MARK}-改名`);
    assert.equal(row.isActive, true);
    assert.equal(row.stopOnMatch, true);
    assert.equal(row.stopProcessing, true);

    await call(appA, 'DELETE', `${rules}/${r.id}`);
    assert.equal((await call(appA, 'PATCH', `${rules}/${r.id}`, { isActive: true })).status, 404);
  });

  test('刪除：軟刪除，enabled 與 isActive 都變成 false', async () => {
    const r = await create(appA, rule({ name: `${MARK}-軟刪` }));
    const res = await call(appA, 'DELETE', `${rules}/${r.id}`);
    assert.equal(res.status, 200);
    const row = await owner.automationRule.findUniqueOrThrow({ where: { id: r.id } });
    assert.equal(row.enabled, false);
    assert.equal(row.isActive, false);
  });

  test('傳送素材：同租戶、啟用中的素材可以存；其他租戶的素材回 400', async () => {
    const ok = await call(appA, 'POST', rules, rule({ name: `${MARK}-素材`, actions: [{ type: 'send_material', params: { materialId: material.id } }] }));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const other = await call(appA, 'POST', rules, rule({ name: `${MARK}-他素材`, actions: [{ type: 'send_material', params: { materialId: materialB.id } }] }));
    assert.equal(other.status, 400);
    assert.equal(other.body.error!.message, '找不到要傳送的素材，或素材已停用');
  });

  test('加好友禮：其他租戶的券回 400；同租戶第二條回 409，其他租戶不受影響', async () => {
    const wrong = await call(appA, 'POST', rules, followGift(couponB.id));
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.error!.message, /找不到可發放的優惠券/);

    await create(appA, followGift(coupon.id));
    const second = await call(appA, 'POST', rules, followGift(coupon.id));
    assert.equal(second.status, 409);
    assert.equal(second.body.error!.code, 'CONFLICT');

    await create(appB, followGift(couponB.id));
  });

  test('改為啟用時檢查契約：不合契約的舊規則回 400，仍可停用', async () => {
    const r = await owner.automationRule.create({
      data: { tenantId: A, name: `${MARK}-舊規則`, eventType: 'message.received', isActive: false, trigger: { type: 'message.received' }, conditions: { all: [] }, actions: [{ type: 'no_such_action', params: {} }] },
    });
    const on = await call(appA, 'PATCH', `${rules}/${r.id}`, { isActive: true });
    assert.equal(on.status, 400);
    assert.equal(on.body.error!.code, 'VALIDATION_ERROR');
    assert.equal((await call(appA, 'PATCH', `${rules}/${r.id}`, { isActive: false, name: `${MARK}-舊規則2` })).status, 200);
  });

  test('試跑：以帶入的事實評估規則，不寫入資料', async () => {
    const r = await create(appA, rule({
      name: `${MARK}-試跑`,
      conditions: { all: [{ fact: 'case.open.count', operator: 'equal', value: 0 }] },
    }));
    const hit = await call(appA, 'POST', `${rules}/${r.id}/test`, { facts: { 'case.open.count': 0 } });
    assert.equal(hit.status, 200, JSON.stringify(hit.body));
    assert.equal(hit.body.data.matched, true);
    assert.equal(hit.body.data.rule.id, r.id);
    const miss = await call(appA, 'POST', `${rules}/${r.id}/test`, { facts: { 'case.open.count': 2 } });
    assert.equal(miss.body.data.matched, false);
    assert.equal(await owner.automationLog.count({ where: { ruleId: r.id } }), 0);
  });

  test('執行紀錄：依規則與成功與否篩選，附規則名稱，不含其他租戶', async () => {
    const r1 = await create(appA, rule({ name: `${MARK}-紀錄一` }));
    const r2 = await create(appA, rule({ name: `${MARK}-紀錄二` }));
    const rb = await create(appB, rule({ name: `${MARK}-紀錄B` }));
    await owner.automationLog.createMany({
      data: [
        { tenantId: A, ruleId: r1.id, success: true },
        { tenantId: A, ruleId: r1.id, success: false, errorMsg: 'x' },
        { tenantId: A, ruleId: r2.id, success: true },
        { tenantId: B, ruleId: rb.id, success: true },
      ],
    });
    const all = await call(appA, 'GET', '/api/v1/automation/logs?limit=100');
    assert.equal(all.status, 200);
    assert.ok((all.body.data as Array<{ tenantId: string }>).every((l) => l.tenantId === A));
    assert.ok(!(all.body.data as Array<{ ruleId: string }>).some((l) => l.ruleId === rb.id));

    const failed = await call(appA, 'GET', `/api/v1/automation/logs?ruleId=${r1.id}&success=false`);
    assert.equal(failed.body.data.length, 1);
    assert.equal(failed.body.data[0].rule.name, `${MARK}-紀錄一`);
    assert.equal((failed.body as unknown as { meta: { total: number } }).meta.total, 1);
  });
});

describe('快速回覆預設組', () => {
  const presets = '/api/v1/line/quick-reply-presets';
  const items = [{ label: '查訂單', text: '我要查訂單' }, { label: '找客服' }];

  test('建立、更新、列表與刪除', async () => {
    const created = await call(appA, 'POST', presets, { name: `  ${MARK}-常用  `, items });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.data.tenantId, A);
    assert.equal(created.body.data.name, `${MARK}-常用`, '名稱去掉前後空白');
    assert.deepEqual(created.body.data.items, items);
    const id = created.body.data.id as string;

    const later = await call(appA, 'POST', presets, { name: `${MARK}-後建`, items });
    const hidden = await call(appA, 'POST', presets, { name: `${MARK}-停用`, items });
    assert.equal((await call(appA, 'PATCH', `${presets}/${hidden.body.data.id}`, { isActive: false })).status, 200);
    await call(appB, 'POST', presets, { name: `${MARK}-B`, items });

    const list = await call(appA, 'GET', presets);
    assert.equal(list.status, 200);
    assert.deepEqual((list.body.data as Array<{ id: string }>).map((p) => p.id), [later.body.data.id, id], '只列啟用中、由新到舊、不含其他租戶');

    const patched = await call(appA, 'PATCH', `${presets}/${id}`, { name: `${MARK}-改名`, items: [{ label: '新按鈕' }] });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.data.name, `${MARK}-改名`);
    assert.deepEqual(patched.body.data.items, [{ label: '新按鈕' }]);

    const removed = await call(appA, 'DELETE', `${presets}/${id}`);
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.data, { deleted: true });
    assert.equal(await owner.quickReplyPreset.count({ where: { id } }), 0);
  });

  test('其他租戶的預設組回 404；名稱只有空白回 400', async () => {
    const created = await call(appA, 'POST', presets, { name: `${MARK}-隔離`, items });
    const id = created.body.data.id as string;
    assert.equal((await call(appB, 'PATCH', `${presets}/${id}`, { name: '改' })).status, 404);
    assert.equal((await call(appB, 'DELETE', `${presets}/${id}`)).status, 404);
    assert.equal(await owner.quickReplyPreset.count({ where: { id } }), 1);

    const blank = await call(appA, 'POST', presets, { name: '   ', items });
    assert.equal(blank.status, 400);
    assert.equal(blank.body.error!.message, '名稱不能為空');
  });
});

describe('路徑的 id 不是 UUID', () => {
  // 原本查詢送到資料庫才失敗，回 400 DATABASE_ERROR，訊息沒有指出欄位（AGENTS.md Conventions：Validation）
  const cases: Array<[method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object]> = [
    ['GET', `${rules}/abc`],
    ['PATCH', `${rules}/abc`, { name: '改' }],
    ['DELETE', `${rules}/abc`],
    ['POST', `${rules}/abc/test`, {}],
    ['PATCH', '/api/v1/line/quick-reply-presets/abc', { name: '改' }],
    ['DELETE', '/api/v1/line/quick-reply-presets/abc'],
  ];
  test.each(cases)('%s %s：回 400 VALIDATION_ERROR，指出 id', async (method, url, payload) => {
    const res = await call(appA, method, url, payload);
    assert.equal(res.status, 400);
    assert.equal(res.body.error!.code, 'VALIDATION_ERROR');
    assert.deepEqual(
      (res.body.error as unknown as { details: { issues: Array<{ path: string }> } }).details.issues.map((i) => i.path),
      ['id'],
    );
  });
});

describe('試跑規則與讀取執行紀錄要求檢視權限', () => {
  const forbidden = (res: Awaited<ReturnType<typeof call>>) => {
    assert.equal(res.status, 403);
    assert.equal((res.body.error as unknown as { details: { requiredPermission: string } }).details.requiredPermission, 'automation.view');
  };

  test('沒有檢視權限時試跑規則', async () => {
    const r = await create(appA, rule({ name: `${MARK}-權限試跑` }));
    forbidden(await call(appInboxOnly, 'POST', `${rules}/${r.id}/test`, {}));
  });

  test('沒有檢視權限時讀取執行紀錄', async () => {
    forbidden(await call(appInboxOnly, 'GET', '/api/v1/automation/logs'));
  });

  test('只有檢視權限時試跑規則與讀取執行紀錄', async () => {
    const r = await create(appA, rule({ name: `${MARK}-只能看` }));
    await owner.automationLog.create({ data: { tenantId: A, ruleId: r.id, success: true } });
    const tested = await call(appViewOnly, 'POST', `${rules}/${r.id}/test`, {});
    assert.equal(tested.status, 200, JSON.stringify(tested.body));
    assert.equal(tested.body.data.rule.id, r.id);
    const logs = await call(appViewOnly, 'GET', `/api/v1/automation/logs?ruleId=${r.id}`);
    assert.equal(logs.status, 200);
    assert.equal(logs.body.data.length, 1);
  });
});
