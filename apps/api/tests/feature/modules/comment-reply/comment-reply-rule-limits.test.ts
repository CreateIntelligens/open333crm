/**
 * 留言規則啟用數硬擋（change add-comment-keyword-private-reply tasks 7.2，design D15「上限檢查點」；
 * spec plan-limits-core「留言規則啟用數硬擋」）。
 *
 * 每個情境自建租戶（方案上限不同），走真實的規則路由、getEffectiveLimit（覆寫優先、null 無上限）與 app_tenant 連線。
 * 403 一律斷言 details.limitKey，確認是上限這道檢查（突變 12.18）。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'vitest';
import { Redis } from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { urls } from '#tests/setup/feature-config.js';
import { createCommentReplyFixtures } from '#tests/support/comment-reply-fixtures.js';
import { createCommentReplyRecords } from '#tests/support/comment-reply-records.js';
import { BASE, buildCommentReplyApp, MANAGE, restorePlatformSettings, setPlatformCapabilities, VIEW } from '#tests/support/comment-reply-app.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: urls.tenant } } });
const redis = new Redis(process.env.REDIS_URL!);
const fx = createCommentReplyFixtures(owner);
const rec = createCommentReplyRecords(owner);
const apps: Array<{ close: () => Promise<unknown> }> = [];
const FEATURES = ['comment_reply', 'channels', 'inbox', 'core'];

beforeAll(async () => {
  await setPlatformCapabilities(owner, {});
});

afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  await restorePlatformSettings(owner);
  await fx.cleanup(rec.cleanup);
  await redis.quit();
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

/** 一個租戶、一個 FB 渠道、一位總店管理者；先建 activeCount 條啟用規則與 inactiveCount 條停用規則 */
async function setup(opts: { limits?: Record<string, number | null>; overrides?: Record<string, number | null>; active: number; inactive?: number }) {
  const tenant = await fx.tenant({ plan: { features: FEATURES, limits: opts.limits ?? {} }, limitOverrides: opts.overrides });
  const fb = await fx.fbChannel(tenant.id, { externalAccountId: `${Date.now()}${Math.floor(Math.random() * 1000)}` });
  const role = await fx.role(tenant.id, [VIEW, MANAGE, 'channel.view', 'channel.view_all']);
  const agent = await fx.agent(tenant.id, role.id);
  const app = await buildCommentReplyApp({ owner, tenantDb, redis }, { id: agent.id, tenantId: tenant.id, roleId: role.id });
  apps.push(app);
  const activeRules = [];
  for (let i = 0; i < opts.active; i++) activeRules.push(await rec.rule(tenant.id, fb.id, { priority: i }));
  const inactiveRules = [];
  for (let i = 0; i < (opts.inactive ?? 0); i++) inactiveRules.push(await rec.rule(tenant.id, fb.id, { isActive: false, priority: 100 + i }));
  const create = (isActive: boolean) =>
    app.inject({
      method: 'POST',
      url: `${BASE}/rules`,
      payload: { channelId: fb.id, name: '新規則', keywords: ['+1'], content: { type: 'text', text: '謝謝' }, isActive },
    });
  return { tenant, fb, app, activeRules, inactiveRules, create };
}

const LIMIT = { maxCommentReplyRules: 2 };

test('建立第三條啟用規則：403 PLAN_LIMIT_EXCEEDED，details 是 { limitKey, current: 2, max: 2 }', async () => {
  const s = await setup({ limits: LIMIT, active: 2 });
  const res = await s.create(true);
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.code, 'PLAN_LIMIT_EXCEEDED');
  assert.deepEqual(res.json().error.details, { limitKey: 'maxCommentReplyRules', current: 2, max: 2 });
});

test('以停用狀態建立：201；之後以 PATCH /rules/:id/active 啟用 → 403', async () => {
  const s = await setup({ limits: LIMIT, active: 2 });
  const created = await s.create(false);
  assert.equal(created.statusCode, 201, created.body);
  const res = await s.app.inject({ method: 'PATCH', url: `${BASE}/rules/${created.json().data.id}/active`, payload: { isActive: true } });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.details.limitKey, 'maxCommentReplyRules');
});

test('PATCH /rules/:id 把 isActive 改 true 也被擋', async () => {
  const s = await setup({ limits: LIMIT, active: 2, inactive: 1 });
  const res = await s.app.inject({ method: 'PATCH', url: `${BASE}/rules/${s.inactiveRules[0].id}`, payload: { isActive: true } });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.details.limitKey, 'maxCommentReplyRules');
  assert.equal((await owner.commentReplyRule.findUniqueOrThrow({ where: { id: s.inactiveRules[0].id } })).isActive, false);
});

test('停用一條後再啟用：兩個請求都成功', async () => {
  const s = await setup({ limits: LIMIT, active: 2, inactive: 1 });
  const off = await s.app.inject({ method: 'PATCH', url: `${BASE}/rules/${s.activeRules[0].id}/active`, payload: { isActive: false } });
  assert.equal(off.statusCode, 200, off.body);
  const on = await s.app.inject({ method: 'PATCH', url: `${BASE}/rules/${s.inactiveRules[0].id}/active`, payload: { isActive: true } });
  assert.equal(on.statusCode, 200, on.body);
});

test('已刪除規則不計入', async () => {
  const s = await setup({ limits: LIMIT, active: 2 });
  await owner.commentReplyRule.update({ where: { id: s.activeRules[0].id }, data: { deletedAt: new Date() } });
  const res = await s.create(true);
  assert.equal(res.statusCode, 201, res.body);
});

test('方案沒有設定上限：建立第 30 條啟用規則 201', async () => {
  const s = await setup({ active: 29 });
  const res = await s.create(true);
  assert.equal(res.statusCode, 201, res.body);
});

test('覆寫值優先：方案上限 10、租戶覆寫 1 → 第 2 條被擋；覆寫 null 則無上限', async () => {
  const s = await setup({ limits: { maxCommentReplyRules: 10 }, overrides: { maxCommentReplyRules: 1 }, active: 1 });
  const blocked = await s.create(true);
  assert.equal(blocked.statusCode, 403, blocked.body);
  assert.equal(blocked.json().error.details.max, 1);

  const u = await setup({ limits: { maxCommentReplyRules: 1 }, overrides: { maxCommentReplyRules: null }, active: 1 });
  const ok = await u.create(true);
  assert.equal(ok.statusCode, 201, ok.body);
});

test('降級後超過上限：已啟用規則照常、GET /rules 每條規則帶 OVER_PLAN_LIMIT 警示', async () => {
  const s = await setup({ active: 5 });
  await owner.plan.update({ where: { id: s.tenant.plan!.id }, data: { limits: { maxCommentReplyRules: 2 } } });
  const res = await s.app.inject({ method: 'GET', url: `${BASE}/rules` });
  assert.equal(res.statusCode, 200, res.body);
  const rules = res.json().data as Array<{ isActive: boolean; warnings: string[] }>;
  assert.equal(rules.length, 5);
  assert.ok(rules.every((r) => r.isActive && r.warnings.includes('OVER_PLAN_LIMIT')));
  // 照常生效：資料庫仍是 5 條啟用規則（收件比對依啟用狀態，不只套前 N 條）
  assert.equal(await owner.commentReplyRule.count({ where: { tenantId: s.tenant.id, isActive: true, deletedAt: null } }), 5);
});
