/**
 * 工單、對話、標籤、短連結路由依權限碼授權（change add-route-permission-guards，AUDIT RBAC-01，issue #197）。
 * 走真實的 requirePermission 與權限計算；原本這 45 條路由只驗登入，租戶設定的角色權限完全不生效。
 *
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import caseRoutes from '#src/modules/case/case.routes.js';
import conversationRoutes from '#src/modules/conversation/conversation.routes.js';
import tagRoutes from '#src/modules/tag/tag.routes.js';
import shortlinkRoutes from '#src/modules/shortlink/shortlink.routes.js';

loadEnvConfig();
const prisma = new PrismaClient();
const T = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const ID = '00000000-0000-4000-8000-000000000abc';
const stamp = Date.now();

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
interface Route {
  method: Method;
  url: string;
  payload?: object;
  /** 通過這條路由需要的權限碼（含依賴） */
  needs: string[];
}
const V = (code: string) => [code.split('.')[0] === 'case' ? 'case.view' : code.split('.')[0] === 'inbox' ? 'inbox.view' : `${code.split('.')[0]}.view`, code];

/** 每一條路由與對應的權限碼（與 proposal 對照表一致） */
const ROUTES: Route[] = [
  // 工單
  { method: 'GET', url: '/api/v1/cases/categories', needs: ['case.view'] },
  { method: 'GET', url: '/api/v1/cases/stats', needs: ['case.view'] },
  { method: 'GET', url: '/api/v1/cases', needs: ['case.view'] },
  { method: 'POST', url: '/api/v1/cases', payload: { contactId: ID, channelId: ID, title: 'x' }, needs: V('case.create') },
  { method: 'GET', url: `/api/v1/cases/${ID}`, needs: ['case.view'] },
  { method: 'PATCH', url: `/api/v1/cases/${ID}`, payload: { title: 'x' }, needs: V('case.update') },
  { method: 'DELETE', url: `/api/v1/cases/${ID}`, needs: V('case.delete') },
  { method: 'POST', url: `/api/v1/cases/${ID}/tags`, payload: { tagId: ID }, needs: V('case.update') },
  { method: 'DELETE', url: `/api/v1/cases/${ID}/tags/${ID}`, needs: V('case.update') },
  { method: 'GET', url: `/api/v1/cases/${ID}/events`, needs: ['case.view'] },
  { method: 'POST', url: `/api/v1/cases/${ID}/notes`, payload: { content: 'x' }, needs: V('case.update') },
  { method: 'POST', url: `/api/v1/cases/${ID}/assign`, payload: { assigneeId: ID }, needs: V('case.assign') },
  { method: 'POST', url: `/api/v1/cases/${ID}/resolve`, payload: {}, needs: V('case.update') },
  { method: 'POST', url: `/api/v1/cases/${ID}/close`, payload: {}, needs: V('case.update') },
  { method: 'POST', url: `/api/v1/cases/${ID}/reopen`, payload: {}, needs: V('case.update') },
  { method: 'POST', url: `/api/v1/cases/${ID}/escalate`, payload: { reason: 'x' }, needs: V('case.escalate') },
  { method: 'POST', url: `/api/v1/cases/${ID}/conversations/${ID}/link`, needs: V('case.update') },
  { method: 'POST', url: `/api/v1/cases/${ID}/csat`, payload: { score: 5 }, needs: V('case.update') },
  { method: 'POST', url: `/api/v1/cases/from-conversation/${ID}`, payload: { title: 'x' }, needs: V('case.create') },
  // 對話
  { method: 'GET', url: '/api/v1/conversations', needs: ['inbox.view'] },
  { method: 'GET', url: `/api/v1/conversations/${ID}`, needs: ['inbox.view'] },
  { method: 'PATCH', url: `/api/v1/conversations/${ID}`, payload: { status: 'CLOSED' }, needs: V('inbox.manage') },
  { method: 'POST', url: `/api/v1/conversations/${ID}/read`, needs: ['inbox.view'] },
  { method: 'POST', url: `/api/v1/conversations/${ID}/tags`, payload: { tagId: ID }, needs: V('inbox.manage') },
  { method: 'DELETE', url: `/api/v1/conversations/${ID}/tags/${ID}`, needs: V('inbox.manage') },
  { method: 'GET', url: `/api/v1/conversations/${ID}/messages`, needs: ['inbox.view'] },
  { method: 'POST', url: `/api/v1/conversations/${ID}/messages`, payload: { contentType: 'text', content: { text: 'x' } }, needs: V('inbox.reply') },
  { method: 'POST', url: `/api/v1/conversations/${ID}/close`, payload: {}, needs: V('inbox.manage') },
  { method: 'POST', url: `/api/v1/conversations/${ID}/handoff`, payload: {}, needs: V('inbox.manage') },
  { method: 'POST', url: `/api/v1/conversations/${ID}/typing`, payload: {}, needs: V('inbox.reply') },
  { method: 'POST', url: `/api/v1/conversations/${ID}/case`, payload: { title: 'x' }, needs: [...V('inbox.view'), ...V('case.create')] },
  { method: 'POST', url: `/api/v1/conversations/${ID}/send-image`, needs: V('inbox.reply') },
  { method: 'POST', url: `/api/v1/conversations/${ID}/send-video`, needs: V('inbox.reply') },
  // 標籤
  { method: 'GET', url: '/api/v1/tags', needs: ['tag.view'] },
  { method: 'POST', url: '/api/v1/tags', payload: { name: `ci-${stamp}` }, needs: V('tag.manage') },
  { method: 'PATCH', url: `/api/v1/tags/${ID}`, payload: { name: 'x' }, needs: V('tag.manage') },
  { method: 'DELETE', url: `/api/v1/tags/${ID}`, needs: V('tag.manage') },
  // 短連結
  { method: 'GET', url: '/api/v1/shortlinks', needs: ['shortlink.view'] },
  { method: 'POST', url: '/api/v1/shortlinks', payload: { targetUrl: 'https://example.com' }, needs: V('shortlink.manage') },
  { method: 'GET', url: `/api/v1/shortlinks/${ID}`, needs: ['shortlink.view'] },
  { method: 'PATCH', url: `/api/v1/shortlinks/${ID}`, payload: { title: 'x' }, needs: V('shortlink.manage') },
  { method: 'DELETE', url: `/api/v1/shortlinks/${ID}`, needs: V('shortlink.manage') },
  { method: 'GET', url: `/api/v1/shortlinks/${ID}/stats`, needs: ['shortlink.view'] },
  { method: 'GET', url: `/api/v1/shortlinks/${ID}/clicks`, needs: ['shortlink.view'] },
  { method: 'GET', url: `/api/v1/shortlinks/${ID}/qrcode`, needs: ['shortlink.view'] },
];

const ALL_CODES = [
  'case.view', 'case.create', 'case.update', 'case.assign', 'case.escalate', 'case.delete',
  'inbox.view', 'inbox.reply', 'inbox.manage', 'tag.view', 'tag.manage', 'shortlink.view', 'shortlink.manage',
];

/** 權限註冊表的 implies：擁有前者即連帶擁有後者（例如管理對話要能看標籤才能加標籤） */
const IMPLIED_BY: Record<string, string[]> = { 'tag.view': ['inbox.manage'] };

const roleIds: string[] = [];
const apps: Array<{ close: () => Promise<unknown> }> = [];

async function createRole(slug: string, permissions: string[]) {
  const role = await prisma.role.create({
    data: {
      tenantId: T,
      slug: `ci-guard-${slug}-${stamp}`.slice(0, 60),
      name: `CI 路由權限（${slug}）`,
      permissions: { create: [...new Set(permissions)].map((permissionCode) => ({ permissionCode })) },
    },
  });
  roleIds.push(role.id);
  return role;
}

async function buildApp(roleId: string) {
  const app = Fastify();
  app.decorate('prisma', prisma);
  app.decorate('prismaAdmin', prisma);
  app.decorate('io', { to: () => ({ emit: () => {} }), emit: () => {} } as never);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: ID, tenantId: T, role: 'AGENT', roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(prisma, T);
  });
  await app.register(caseRoutes, { prefix: '/api/v1/cases' });
  await app.register(conversationRoutes, { prefix: '/api/v1/conversations' });
  await app.register(tagRoutes, { prefix: '/api/v1/tags' });
  await app.register(shortlinkRoutes, { prefix: '/api/v1/shortlinks' });
  await app.ready();
  apps.push(app);
  return app;
}
const call = (app: Awaited<ReturnType<typeof buildApp>>, r: Route) => app.inject({ method: r.method, url: r.url, payload: r.payload });
const label = (r: Route) => `${r.method} ${r.url.replace(new RegExp(ID, 'g'), ':id')}`;

test('沒有任何權限的角色：45 條路由全部回 403', async () => {
  assert.equal(ROUTES.length, 45);
  const app = await buildApp((await createRole('none', [])).id);
  const leaks: string[] = [];
  for (const r of ROUTES) {
    const res = await call(app, r);
    if (res.statusCode !== 403) leaks.push(`${label(r)} → ${res.statusCode}`);
  }
  assert.deepEqual(leaks, [], `以下路由沒擋：\n${leaks.join('\n')}`);
});

test('缺少該路由需要的權限碼（其他全都有）：回 403', async () => {
  const leaks: string[] = [];
  const byMissing = new Map<string, Awaited<ReturnType<typeof buildApp>>>();
  for (const r of ROUTES) {
    // 缺的是這條路由「本身」要的權限碼（needs 的最後一個）；依賴碼保留，只測這一個
    const missing = r.needs[r.needs.length - 1]!;
    let app = byMissing.get(missing);
    if (!app) {
      const drop = new Set([missing, ...(IMPLIED_BY[missing] ?? [])]);
      app = await buildApp((await createRole(`no-${missing}`, ALL_CODES.filter((c) => !drop.has(c)))).id);
      byMissing.set(missing, app);
    }
    const res = await call(app, r);
    if (res.statusCode !== 403) leaks.push(`${label(r)} 缺 ${missing} → ${res.statusCode}`);
  }
  assert.deepEqual(leaks, [], `以下路由沒檢查到正確的權限碼：\n${leaks.join('\n')}`);
});

test('只具備該路由需要的權限碼：通過權限檢查（不回 403）', async () => {
  const blocked: string[] = [];
  const byNeeds = new Map<string, Awaited<ReturnType<typeof buildApp>>>();
  for (const r of ROUTES) {
    const key = [...new Set(r.needs)].sort().join(',');
    let app = byNeeds.get(key);
    if (!app) {
      app = await buildApp((await createRole(`only-${key}`, r.needs)).id);
      byNeeds.set(key, app);
    }
    const res = await call(app, r);
    if (res.statusCode === 403) blocked.push(`${label(r)}（具備 ${key}）→ 403 ${res.body.slice(0, 120)}`);
  }
  assert.deepEqual(blocked, [], `以下路由擋過頭：\n${blocked.join('\n')}`);
});

test('只有 case.view + case.update：PATCH 改負責人或升級回 403，改標題通過', async () => {
  const app = await buildApp((await createRole('case-update', ['case.view', 'case.update'])).id);
  const patch = (payload: object) => app.inject({ method: 'PATCH', url: `/api/v1/cases/${ID}`, payload });
  assert.equal((await patch({ assigneeId: ID })).statusCode, 403, '改負責人需要 case.assign');
  assert.equal((await patch({ teamId: ID })).statusCode, 403, '改團隊需要 case.assign');
  assert.equal((await patch({ status: 'ESCALATED' })).statusCode, 403, '升級需要 case.escalate');
  assert.notEqual((await patch({ title: 'x' })).statusCode, 403);
  assert.notEqual((await patch({ status: 'IN_PROGRESS' })).statusCode, 403, '其他狀態只需 case.update');

  const assignApp = await buildApp((await createRole('case-assign', ['case.view', 'case.update', 'case.assign'])).id);
  assert.notEqual((await assignApp.inject({ method: 'PATCH', url: `/api/v1/cases/${ID}`, payload: { assigneeId: ID } })).statusCode, 403);
});

afterAll(async () => {
  for (const app of apps) await app.close();
  await prisma.rolePermission.deleteMany({ where: { roleId: { in: roleIds } } });
  await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
  await prisma.$disconnect();
});
