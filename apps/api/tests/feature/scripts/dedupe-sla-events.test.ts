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
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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

const plus = (d: Date, seconds: number) => new Date(d.getTime() + seconds * 1000);
const EN_FR_BREACHED = { type: 'first_response_breached', title: 'First response SLA breached' };

test('通知：同一週期每天重複的事件與通知只留最早一組（每位成員各一筆）', async () => {
  await inRolledBackTransaction(async (tx) => {
    const s = await seedTenant(tx, '通知同週期');
    const c = await s.newCase();
    const kept: string[] = [];
    for (const d of [2, 3, 4]) {
      await event(tx, c.id, 'first_response_breached', day(d), { 'sla.dueAt': DUE_A });
      for (const agent of [s.assignee, s.admin]) {
        // 舊程式先寫事件再把通知丟進佇列，通知晚幾秒寫入
        const n = await notification(tx, {
          ...EN_FR_BREACHED, tenantId: s.tenant.id, agentId: agent.id, caseId: c.id, createdAt: plus(day(d), 3),
        });
        if (d === 2) kept.push(n.id);
      }
    }

    const result = await run(tx, [s.tenant.id]);

    assert.equal(result.report.notifications.total, 4);
    assert.equal(result.applied.deletedNotifications, 4);
    const left = await tx.notification.findMany({ where: { tenantId: s.tenant.id } });
    assert.deepEqual(left.map((n) => n.id).sort(), kept.sort());
  });
});

test('通知：同工單同成員兩個不同期限週期各一筆通知都保留', async () => {
  await inRolledBackTransaction(async (tx) => {
    const s = await seedTenant(tx, '通知不同週期');
    const c = await s.newCase();
    await event(tx, c.id, 'sla_breached', day(2), { 'sla.dueAt': DUE_A });
    await event(tx, c.id, 'sla_breached', day(6), { 'sla.dueAt': DUE_B });
    for (const d of [2, 6]) {
      await notification(tx, {
        tenantId: s.tenant.id, agentId: s.admin.id, caseId: c.id,
        type: 'sla_breached', title: 'Resolution SLA breached', createdAt: plus(day(d), 2),
      });
    }

    const result = await run(tx, [s.tenant.id]);

    assert.equal(result.report.notifications.total, 0);
    assert.equal(result.report.notifications.matchedKept, 2);
    assert.equal(await tx.notification.count({ where: { tenantId: s.tenant.id } }), 2);
  });
});

test('通知：對不到被刪事件的英文通知、中文通知、自動化規則通知都不動，報表列出配對數', async () => {
  await inRolledBackTransaction(async (tx) => {
    const s = await seedTenant(tx, '通知配對');
    const c = await s.newCase();
    await event(tx, c.id, 'first_response_breached', day(2), { 'sla.dueAt': DUE_A });
    await event(tx, c.id, 'first_response_breached', day(3), { 'sla.dueAt': DUE_A });
    const base = { ...EN_FR_BREACHED, tenantId: s.tenant.id, agentId: s.admin.id, caseId: c.id };
    await notification(tx, { ...base, createdAt: plus(day(2), 1) });
    const paired = await notification(tx, { ...base, createdAt: plus(day(3), 1) });
    // 時間對不到任何事件（例如事件已被別的方式刪掉）
    const orphan = await notification(tx, { ...base, createdAt: day(5) });
    // 已刪事件同一成員第二筆通知：每筆被刪事件每位成員最多配對一筆
    const second = await notification(tx, { ...base, createdAt: plus(day(3), 30) });
    for (const title of ['首次回應已逾期', 'SLA rule matched']) {
      await notification(tx, { ...base, title, createdAt: plus(day(3), 1) });
    }

    const result = await run(tx, [s.tenant.id]);

    const n = result.report.notifications;
    assert.equal(n.english, 4);
    assert.equal(n.total, 1);
    assert.equal(n.matchedKept, 1);
    assert.equal(n.unmatched, 1);
    assert.equal(n.extraOnDeleted, 1);
    const left = (await tx.notification.findMany({ where: { tenantId: s.tenant.id } })).map((x) => x.id);
    assert.ok(!left.includes(paired.id));
    assert.ok(left.includes(orphan.id));
    assert.ok(left.includes(second.id));
    assert.equal(left.length, 5);
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

/** 解析本腳本寫出的 CSV：有值的欄位一律加引號，空欄位（沒有引號）代表 NULL */
function parseCsv(text: string): Array<Array<string | null>> {
  const rows: Array<Array<string | null>> = [];
  let row: Array<string | null> = [];
  let i = 0;
  while (i < text.length) {
    let value: string | null = null;
    if (text[i] === '"') {
      value = '';
      i += 1;
      for (;;) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') { value += '"'; i += 2; continue; }
          i += 1;
          break;
        }
        value += text[i];
        i += 1;
      }
    }
    row.push(value);
    if (text[i] === ',') { i += 1; continue; }
    rows.push(row);
    row = [];
    i += 1;
  }
  return rows;
}

test('--apply 先把要刪的整列匯出成 CSV，payload 可以 JSON.parse 回原本的 facts', async () => {
  await inRolledBackTransaction(async (tx) => {
    const s = await seedTenant(tx, 'CSV');
    const c = await s.newCase('含 "引號", 逗號');
    await event(tx, c.id, 'sla_breached', day(2), { 'sla.dueAt': DUE_A });
    const facts = { 'sla.dueAt': DUE_A, note: 'a "b", c', tags: ['vip'], n: 3 };
    const dup = await event(tx, c.id, 'sla_breached', day(3), facts);
    await notification(tx, {
      tenantId: s.tenant.id, agentId: s.admin.id, caseId: c.id,
      type: 'sla_breached', title: 'Resolution SLA breached', createdAt: day(2),
    });
    const dupNotification = await notification(tx, {
      tenantId: s.tenant.id, agentId: s.admin.id, caseId: c.id,
      type: 'sla_breached', title: 'Resolution SLA breached', createdAt: day(3),
    });

    const result = await run(tx, [s.tenant.id]);

    const rows = parseCsv(await readFile(result.applied.files.events, 'utf8'));
    assert.deepEqual(rows[0], ['id', 'tenantId', 'caseId', 'actorType', 'actorId', 'eventType', 'payload', 'createdAt']);
    assert.equal(rows.length, 2);
    const [id, tenantId, caseId, actorType, actorId, eventType, payload, createdAt] = rows[1]!;
    assert.deepEqual([id, tenantId, caseId, actorType, actorId, eventType], [dup.id, s.tenant.id, c.id, 'system', null, 'sla_breached']);
    assert.deepEqual(JSON.parse(payload!).facts, facts);
    assert.equal(createdAt, day(3).toISOString());
    const notificationRows = parseCsv(await readFile(result.applied.files.notifications, 'utf8'));
    assert.equal(notificationRows[1]![0], dupNotification.id);
  });
});

test('照 SLA.md 的還原步驟，可以從 CSV 把刪掉的列寫回', async () => {
  await inRolledBackTransaction(async (tx) => {
    const s = await seedTenant(tx, '還原');
    const c = await s.newCase();
    await event(tx, c.id, 'customer_waiting_breached', day(2), { 'case.lastAgentReplyAt': null });
    const dup = await event(tx, c.id, 'customer_waiting_breached', day(3), { 'case.lastAgentReplyAt': null, x: [1, { y: 'z' }] });
    await notification(tx, {
      tenantId: s.tenant.id, agentId: s.admin.id, caseId: c.id,
      type: 'customer_waiting_breached', title: 'Customer waiting SLA breached', createdAt: day(2),
    });
    const dupNotification = await notification(tx, {
      tenantId: s.tenant.id, agentId: s.admin.id, caseId: c.id,
      type: 'customer_waiting_breached', title: 'Customer waiting SLA breached', createdAt: plus(day(3), 5),
    });
    await tx.notification.update({ where: { id: dupNotification.id }, data: { isRead: true, readAt: day(4) } });
    const originalNotification = await tx.notification.findUniqueOrThrow({ where: { id: dupNotification.id } });

    const result = await run(tx, [s.tenant.id]);
    assert.equal(await tx.caseEvent.count({ where: { id: dup.id } }), 0);

    // 取 SLA.md「還原」的 SQL 照順序執行；\copy 是 psql 指令，改成把 CSV 的每個欄位以文字
    // 交給資料庫轉成暫存表的型別（與 \copy 的 FORMAT csv 相同：沒有引號的空欄位是 NULL）
    const doc = await readFile(resolve(repoRoot, 'docs/ref/features/SLA.md'), 'utf8');
    const restoreSql = doc.slice(doc.indexOf('### 還原')).match(/```sql\n([\s\S]*?)```/)![1]!;
    const statements = restoreSql
      .split('\n').filter((line) => !line.startsWith('\\copy')).join('\n')
      .split(/;\s*\n/).map((x) => x.trim()).filter(Boolean);
    const [createEvents, createNotifications, ...inserts] = statements;
    await tx.$executeRawUnsafe(createEvents!);
    await tx.$executeRawUnsafe(createNotifications!);
    const load = async (table: string, file: string) => {
      const [header, ...rows] = parseCsv(await readFile(file, 'utf8'));
      const types = (await tx.$queryRawUnsafe(
        `SELECT attname, format_type(atttypid, atttypmod) AS t FROM pg_attribute WHERE attrelid = '${table}'::regclass AND attnum > 0`,
      )) as Array<{ attname: string; t: string }>;
      const typeOf = new Map(types.map((x) => [x.attname, x.t]));
      const cols = header!.map((h) => `"${h}"`).join(', ');
      const values = header!.map((h, k) => `$${k + 1}::text::${typeOf.get(h!)}`).join(', ');
      for (const r of rows) await tx.$executeRawUnsafe(`INSERT INTO ${table} (${cols}) VALUES (${values})`, ...r);
    };
    await load('restore_case_events', result.applied.files.events);
    await load('restore_notifications', result.applied.files.notifications);
    assert.equal(inserts.length, 2);
    for (const sql of inserts) await tx.$executeRawUnsafe(sql);

    const restored = await tx.caseEvent.findUniqueOrThrow({ where: { id: dup.id } });
    assert.deepEqual(restored, dup);
    assert.deepEqual(await tx.notification.findUniqueOrThrow({ where: { id: dupNotification.id } }), originalNotification);
  });
});

test('CSV 檔名已存在時中止，不刪除先前就存在的檔案', async () => {
  await inRolledBackTransaction(async (tx) => {
    const s = await seedTenant(tx, '既有檔案');
    const c = await s.newCase();
    for (const d of [2, 3]) {
      await event(tx, c.id, 'sla_breached', day(d), { 'sla.dueAt': DUE_A });
      await notification(tx, {
        tenantId: s.tenant.id, agentId: s.admin.id, caseId: c.id,
        type: 'sla_breached', title: 'Resolution SLA breached', createdAt: day(d),
      });
    }
    const stamp = `fixed-${Date.now()}`;
    const existing = join(outDir, `sla-dedupe-${stamp}-notifications.csv`);
    await writeFile(existing, '先前的備份');

    await assert.rejects(run(tx, [s.tenant.id], { fileStamp: stamp }), /EEXIST/);

    assert.equal(await readFile(existing, 'utf8'), '先前的備份');
    assert.ok(!existsSync(join(outDir, `sla-dedupe-${stamp}-case-events.csv`)), '這次建立的檔案要清掉');
    assert.equal((await remainingEvents(tx, c.id)).length, 2);
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
