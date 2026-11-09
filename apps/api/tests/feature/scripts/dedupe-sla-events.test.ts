/**
 * 一次性清理腳本 scripts/dedupe-sla-events.mjs（issue #320）。
 *
 * #281 前的 SLA 掃描以「24 小時內有沒有同類事件」去重，逾期工單每天重寫一筆時間軸事件、
 * 重發一次通知。腳本依「同一張工單、同一種事件、同一個期限 key」只留最早一筆，
 * 並刪除重複的英文標題 SLA 通知。
 *
 * 測試在 owner（superuser）交易內建資料、呼叫腳本匯出的 runDedupe()，斷言後一律回滾：
 * 腳本的 SQL 是全域的，不能留下對其他測試資料的寫入。每個情境都帶 tenants 限定自建租戶。
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient, Prisma } from '@prisma/client';
import { afterAll, beforeAll, test } from 'vitest';
import { repoRoot } from '#tests/support/paths.js';

const owner = new PrismaClient();
const MARK = `ci-sla-dedupe-${Date.now()}`;
const CUTOFF = new Date('2026-10-15T08:00:00.000Z');

// 腳本是給 node 直接執行的 .mjs，沒有型別宣告
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let script: any;
let outDir: string;

beforeAll(async () => {
  script = await import(pathToFileURL(resolve(repoRoot, 'scripts/dedupe-sla-events.mjs')).href);
  outDir = await mkdtemp(join(tmpdir(), 'sla-dedupe-'));
});

afterAll(async () => {
  await owner.$disconnect();
  await rm(outDir, { recursive: true, force: true });
});

class Rollback extends Error {}

async function inRolledBackTransaction(fn: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await owner.$transaction(
      async (tx) => {
        await fn(tx);
        throw new Rollback();
      },
      { timeout: 60_000 },
    );
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
}

let seq = 0;
async function seedTenant(tx: Prisma.TransactionClient, label: string) {
  seq += 1;
  const tenant = await tx.tenant.create({ data: { name: `${MARK} ${label}` } });
  const agent = (slug: string) =>
    tx.agent.create({
      data: { tenantId: tenant.id, email: `${MARK}-${seq}-${slug}@example.test`, name: slug, passwordHash: 'x' },
    });
  const contact = await tx.contact.create({ data: { tenantId: tenant.id, displayName: `${MARK} 顧客` } });
  const channel = await tx.channel.create({
    data: { tenantId: tenant.id, channelType: 'WEBCHAT', displayName: `${MARK}-${seq}`, credentialsEncrypted: 'x' },
  });
  const newCase = (title = '逾期工單') =>
    tx.case.create({ data: { tenantId: tenant.id, contactId: contact.id, channelId: channel.id, title } });
  return { tenant, admin: await agent('admin'), assignee: await agent('assignee'), newCase };
}

const day = (n: number, hour = 1) => new Date(Date.UTC(2026, 9, n, hour, 0, 0));
const DUE_A = '2026-10-01T00:00:00.000Z';
const DUE_B = '2026-10-05T00:00:00.000Z';

function event(
  tx: Prisma.TransactionClient,
  caseId: string,
  eventType: string,
  createdAt: Date,
  facts: Record<string, unknown> | null,
  actorType = 'system',
) {
  return tx.caseEvent.create({
    data: {
      caseId,
      actorType,
      eventType,
      createdAt,
      payload: (facts ? { eventName: 'sla.x', facts } : {}) as Prisma.InputJsonValue,
    },
  });
}

function notification(
  tx: Prisma.TransactionClient,
  data: { tenantId: string; agentId: string; caseId: string; type: string; title: string; createdAt: Date },
) {
  return tx.notification.create({
    data: {
      tenantId: data.tenantId,
      agentId: data.agentId,
      type: data.type,
      title: data.title,
      body: 'x',
      clickUrl: `/dashboard/cases/${data.caseId}`,
      createdAt: data.createdAt,
    },
  });
}

const remainingEvents = (tx: Prisma.TransactionClient, caseId: string) =>
  tx.caseEvent.findMany({ where: { caseId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

const run = (tx: Prisma.TransactionClient, tenantIds: string[], extra: Record<string, unknown> = {}) =>
  script.runDedupe(tx, {
    cutoff: CUTOFF,
    tenants: tenantIds,
    apply: true,
    notifications: 'delete',
    outDir,
    log: () => {},
    ...extra,
  });

test('同一期限跨多天重複的逾期事件只留最早一筆', async () => {
  await inRolledBackTransaction(async (tx) => {
    const s = await seedTenant(tx, '同期限');
    const c = await s.newCase();
    const first = await event(tx, c.id, 'sla_breached', day(2), { 'sla.dueAt': DUE_A });
    await event(tx, c.id, 'sla_breached', day(3), { 'sla.dueAt': DUE_A });
    await event(tx, c.id, 'sla_breached', day(4), { 'sla.dueAt': DUE_A });
    const fr = await event(tx, c.id, 'first_response_breached', day(2), { 'sla.dueAt': DUE_A });
    await event(tx, c.id, 'first_response_breached', day(3), { 'sla.dueAt': DUE_A });

    const result = await run(tx, [s.tenant.id]);

    assert.equal(result.report.events.total, 3);
    assert.equal(result.applied.deletedEvents, 3);
    assert.deepEqual((await remainingEvents(tx, c.id)).map((e) => e.id).sort(), [first.id, fr.id].sort());
  });
});

test('期限不同的逾期事件都保留；警告類的提前分鐘數不同也都保留', async () => {
  await inRolledBackTransaction(async (tx) => {
    const s = await seedTenant(tx, '不同期限');
    const c = await s.newCase();
    await event(tx, c.id, 'sla_breached', day(2), { 'sla.dueAt': DUE_A });
    await event(tx, c.id, 'sla_breached', day(6), { 'sla.dueAt': DUE_B });
    await event(tx, c.id, 'sla_warning', day(1, 1), { 'sla.dueAt': DUE_A, 'sla.warningBeforeMinutes': 30 });
    await event(tx, c.id, 'sla_warning', day(1, 2), { 'sla.dueAt': DUE_A, 'sla.warningBeforeMinutes': 60 });
    const keptWarning = await event(tx, c.id, 'first_response_warning', day(1, 3), {
      'sla.dueAt': DUE_A,
      'sla.warningBeforeMinutes': 30,
    });
    const dupWarning = await event(tx, c.id, 'first_response_warning', day(2, 3), {
      'sla.dueAt': DUE_A,
      'sla.warningBeforeMinutes': 30,
    });

    const result = await run(tx, [s.tenant.id]);

    assert.equal(result.applied.deletedEvents, 1);
    const ids = (await remainingEvents(tx, c.id)).map((e) => e.id);
    assert.equal(ids.length, 5);
    assert.ok(ids.includes(keptWarning.id));
    assert.ok(!ids.includes(dupWarning.id));
  });
});

test('客戶等待事件：最後回覆時間不同都保留，同為 null 只留最早一筆', async () => {
  await inRolledBackTransaction(async (tx) => {
    const s = await seedTenant(tx, '客戶等待');
    const c = await s.newCase();
    const nullFirst = await event(tx, c.id, 'customer_waiting_breached', day(2), { 'case.lastAgentReplyAt': null });
    await event(tx, c.id, 'customer_waiting_breached', day(3), { 'case.lastAgentReplyAt': null });
    const replyA = await event(tx, c.id, 'customer_waiting_breached', day(4), {
      'case.lastAgentReplyAt': '2026-10-03T10:00:00.000Z',
    });
    const replyB = await event(tx, c.id, 'customer_waiting_breached', day(6), {
      'case.lastAgentReplyAt': '2026-10-05T10:00:00.000Z',
    });

    const result = await run(tx, [s.tenant.id]);

    assert.equal(result.applied.deletedEvents, 1);
    assert.deepEqual(
      (await remainingEvents(tx, c.id)).map((e) => e.id),
      [nullFirst.id, replyA.id, replyB.id],
    );
  });
});

test('cutoff 之後的列不列入刪除，另計為 cutoff 之後的重複', async () => {
  await inRolledBackTransaction(async (tx) => {
    const s = await seedTenant(tx, 'cutoff 預覽');
    const c = await s.newCase();
    await event(tx, c.id, 'sla_breached', day(2), { 'sla.dueAt': DUE_A });
    await event(tx, c.id, 'sla_breached', day(3), { 'sla.dueAt': DUE_A });
    await event(tx, c.id, 'sla_breached', day(16), { 'sla.dueAt': DUE_A });

    const result = await run(tx, [s.tenant.id], { apply: false });

    assert.equal(result.report.events.total, 1);
    assert.equal(result.report.afterCutoff.events, 1);
    assert.equal(result.applied, null);
    assert.equal((await remainingEvents(tx, c.id)).length, 3);
  });
});

test('cutoff 之後有重複時拒絕 --apply，什麼都不刪', async () => {
  await inRolledBackTransaction(async (tx) => {
    const s = await seedTenant(tx, 'cutoff 拒絕');
    const c = await s.newCase();
    await event(tx, c.id, 'sla_breached', day(2), { 'sla.dueAt': DUE_A });
    await event(tx, c.id, 'sla_breached', day(3), { 'sla.dueAt': DUE_A });
    await event(tx, c.id, 'sla_breached', day(16), { 'sla.dueAt': DUE_A });

    await assert.rejects(run(tx, [s.tenant.id]), /cutoff 之後/);
    assert.equal((await remainingEvents(tx, c.id)).length, 3);
  });
});

test('沒有期限 key 的舊列與非系統寫入的列不動，另計沒有 key 的列數', async () => {
  await inRolledBackTransaction(async (tx) => {
    const s = await seedTenant(tx, '沒有 key');
    const c = await s.newCase();
    await event(tx, c.id, 'sla_breached', day(2), null);
    await event(tx, c.id, 'sla_breached', day(3), null);
    await event(tx, c.id, 'sla_warning', day(2), { 'sla.dueAt': DUE_A });
    await event(tx, c.id, 'sla_warning', day(3), { 'sla.dueAt': DUE_A });
    await event(tx, c.id, 'customer_waiting_breached', day(2), { other: 1 });
    await event(tx, c.id, 'customer_waiting_breached', day(3), { other: 1 });
    await event(tx, c.id, 'sla_breached', day(4), { 'sla.dueAt': DUE_A }, 'agent');
    await event(tx, c.id, 'sla_breached', day(5), { 'sla.dueAt': DUE_A }, 'agent');

    const result = await run(tx, [s.tenant.id]);

    assert.equal(result.report.events.total, 0);
    const missing = Object.fromEntries(
      result.report.missingKey.map((r: { eventType: string; count: number }) => [r.eventType, r.count]),
    );
    assert.deepEqual(missing, { sla_breached: 2, sla_warning: 2, customer_waiting_breached: 2 });
    assert.equal((await remainingEvents(tx, c.id)).length, 8);
  });
});

test('--tenant 只處理指定租戶', async () => {
  await inRolledBackTransaction(async (tx) => {
    const a = await seedTenant(tx, '指定');
    const b = await seedTenant(tx, '未指定');
    const ca = await a.newCase();
    const cb = await b.newCase();
    for (const c of [ca, cb]) {
      await event(tx, c.id, 'sla_breached', day(2), { 'sla.dueAt': DUE_A });
      await event(tx, c.id, 'sla_breached', day(3), { 'sla.dueAt': DUE_A });
    }
    for (const s of [a, b]) {
      const c = s === a ? ca : cb;
      for (const d of [2, 3]) {
        await notification(tx, {
          tenantId: s.tenant.id, agentId: s.admin.id, caseId: c.id,
          type: 'sla_breached', title: 'Resolution SLA breached', createdAt: day(d),
        });
      }
    }

    const result = await run(tx, [a.tenant.id]);

    assert.deepEqual(
      result.report.events.byTenant.map((r: { tenantId: string }) => r.tenantId),
      [a.tenant.id],
    );
    assert.equal((await remainingEvents(tx, ca.id)).length, 1);
    assert.equal((await remainingEvents(tx, cb.id)).length, 2);
    assert.equal(await tx.notification.count({ where: { tenantId: a.tenant.id } }), 1);
    assert.equal(await tx.notification.count({ where: { tenantId: b.tenant.id } }), 2);
  });
});

test('通知：只處理英文標題的 SLA 通知，每位成員、每張工單、每種類型只留最早一筆', async () => {
  await inRolledBackTransaction(async (tx) => {
    const s = await seedTenant(tx, '通知');
    const c1 = await s.newCase();
    const c2 = await s.newCase();
    const base = { tenantId: s.tenant.id, type: 'first_response_breached', title: 'First response SLA breached' };
    const keep = await notification(tx, { ...base, agentId: s.admin.id, caseId: c1.id, createdAt: day(2) });
    await notification(tx, { ...base, agentId: s.admin.id, caseId: c1.id, createdAt: day(3) });
    await notification(tx, { ...base, agentId: s.admin.id, caseId: c1.id, createdAt: day(4) });
    // 不同工單、不同成員各自保留
    await notification(tx, { ...base, agentId: s.admin.id, caseId: c2.id, createdAt: day(3) });
    await notification(tx, { ...base, agentId: s.assignee.id, caseId: c1.id, createdAt: day(3) });
    // #281 後的中文標題不處理
    for (const d of [2, 3]) {
      await notification(tx, {
        tenantId: s.tenant.id, agentId: s.admin.id, caseId: c1.id,
        type: 'first_response_breached', title: '首次回應已逾期', createdAt: day(d),
      });
    }
    // 英文但不是 SLA 預設標題（自動化規則的通知）不處理
    for (const d of [2, 3]) {
      await notification(tx, {
        tenantId: s.tenant.id, agentId: s.admin.id, caseId: c1.id,
        type: 'sla_breached', title: 'SLA rule matched', createdAt: day(d),
      });
    }

    const result = await run(tx, [s.tenant.id]);

    assert.equal(result.report.notifications.total, 2);
    assert.equal(result.applied.deletedNotifications, 2);
    const english = await tx.notification.findMany({
      where: { tenantId: s.tenant.id, title: 'First response SLA breached', agentId: s.admin.id, clickUrl: `/dashboard/cases/${c1.id}` },
    });
    assert.deepEqual(english.map((n) => n.id), [keep.id]);
    assert.equal(await tx.notification.count({ where: { tenantId: s.tenant.id } }), 1 + 2 + 2 + 2);
  });
});

test('--notifications=skip 不動通知', async () => {
  await inRolledBackTransaction(async (tx) => {
    const s = await seedTenant(tx, '略過通知');
    const c = await s.newCase();
    for (const d of [2, 3]) {
      await notification(tx, {
        tenantId: s.tenant.id, agentId: s.admin.id, caseId: c.id,
        type: 'sla_warning', title: 'Resolution SLA warning', createdAt: day(d),
      });
    }

    const result = await run(tx, [s.tenant.id], { notifications: 'skip' });

    assert.equal(result.report.notifications, null);
    assert.equal(await tx.notification.count({ where: { tenantId: s.tenant.id } }), 2);
  });
});

test('--apply 先把要刪的整列匯出成 CSV', async () => {
  await inRolledBackTransaction(async (tx) => {
    const s = await seedTenant(tx, 'CSV');
    const c = await s.newCase('含 "引號", 逗號');
    await event(tx, c.id, 'sla_breached', day(2), { 'sla.dueAt': DUE_A });
    const dup = await event(tx, c.id, 'sla_breached', day(3), { 'sla.dueAt': DUE_A, note: 'a "b", c' });
    await notification(tx, {
      tenantId: s.tenant.id, agentId: s.admin.id, caseId: c.id,
      type: 'sla_breached', title: 'Resolution SLA breached', createdAt: day(2),
    });
    const dupNotification = await notification(tx, {
      tenantId: s.tenant.id, agentId: s.admin.id, caseId: c.id,
      type: 'sla_breached', title: 'Resolution SLA breached', createdAt: day(3),
    });

    const result = await run(tx, [s.tenant.id]);

    const eventsCsv = await readFile(result.applied.files.events, 'utf8');
    const lines = eventsCsv.trim().split('\n');
    assert.equal(lines.length, 2);
    assert.ok(lines[0]!.startsWith('"id","tenantId","caseId"'));
    assert.ok(lines[1]!.includes(dup.id));
    // payload 是 JSON 文字（a \"b\", c），放進 CSV 時雙引號再加倍
    assert.ok(lines[1]!.includes('a \\""b\\"", c'), '欄位內的雙引號要跳脫');
    const notificationsCsv = await readFile(result.applied.files.notifications, 'utf8');
    assert.ok(notificationsCsv.includes(dupNotification.id));
  });
});

test('預期筆數與這次預覽不一致時拒絕刪除', async () => {
  await inRolledBackTransaction(async (tx) => {
    const s = await seedTenant(tx, '預期筆數');
    const c = await s.newCase();
    await event(tx, c.id, 'sla_breached', day(2), { 'sla.dueAt': DUE_A });
    await event(tx, c.id, 'sla_breached', day(3), { 'sla.dueAt': DUE_A });
    const before = new Set(await readdir(outDir));

    await assert.rejects(run(tx, [s.tenant.id], { expectEvents: 5 }), /預期/);

    assert.equal((await remainingEvents(tx, c.id)).length, 2);
    assert.deepEqual(new Set(await readdir(outDir)), before, '拒絕時不留下 CSV');
  });
});

test('dry-run 的報表列出重複最多的工單與依 breachCount 判斷的啟用中規則', async () => {
  await inRolledBackTransaction(async (tx) => {
    const s = await seedTenant(tx, '報表');
    const c = await s.newCase('最多重複');
    for (const d of [2, 3, 4]) await event(tx, c.id, 'sla_breached', day(d), { 'sla.dueAt': DUE_A });
    const rule = await tx.automationRule.create({
      data: {
        tenantId: s.tenant.id,
        name: `${MARK} 逾期兩次升級`,
        eventType: 'sla.resolution.breached',
        conditions: { all: [{ fact: 'sla.breachCount', operator: 'greaterThanInclusive', value: 2 }] },
      },
    });
    await tx.automationRule.create({
      data: {
        tenantId: s.tenant.id,
        name: `${MARK} 無關規則`,
        eventType: 'sla.resolution.breached',
        conditions: { all: [{ fact: 'case.priority', operator: 'equal', value: 'HIGH' }] },
      },
    });

    const result = await run(tx, [s.tenant.id], { apply: false });

    assert.equal(result.report.topCases[0].caseId, c.id);
    assert.equal(result.report.topCases[0].toDelete, 2);
    assert.deepEqual(result.report.affectedRules.map((r: { id: string }) => r.id), [rule.id]);
  });
});

test('連線身分不能略過 RLS 時直接失敗，不會回報 0 筆', async () => {
  await assert.rejects(
    owner.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE app_tenant');
      await run(tx, [], { apply: false });
    }),
    /略過 RLS/,
  );
});
