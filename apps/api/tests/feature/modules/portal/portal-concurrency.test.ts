/**
 * 粉絲活動與積分在並行請求下的正確性。
 *
 * 「先讀、再寫」沒有鎖時，同時進來的請求都會通過檢查：
 *  - 同一位粉絲同時送出不允許重複參加的活動，留下兩筆作答與兩次積分
 *  - 同時寫同一位聯絡人的積分帳本，兩筆都以同一個餘額計算
 *  - 同時抽獎，抽到同一批人
 *  - 活動狀態檢查之後、更新之前，另一個交易改了狀態（例如編輯已發布的活動）
 *
 * 交易 1 停在 commit 之前，交易 2 開始後再放開交易 1，以 pg_blocking_pids 確認交易 2 卡在鎖上。
 * 屬於 feature 組：需要真的 PostgreSQL 才能重現並行。每次執行建立一個專用租戶，結束時整個刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { inTenant, type TenantScope } from '#src/lib/tenant-ctx.js';
import {
  deleteActivity,
  drawWinners,
  publishActivity,
  submitActivity,
  updateActivity,
} from '#src/modules/portal/portal.service.js';
import { addPointTransaction } from '#src/modules/portal/points.service.js';
import { mergeContacts, revertMerge } from '#src/modules/contact/contact-merge.service.js';
import {
  adjustPointsFlow,
  archiveActivityFlow,
  deleteActivityFlow,
  drawWinnersFlow,
  publishActivityFlow,
  submitActivityFlow,
  updateActivityFlow,
} from '#src/modules/portal/portal.flow.js';
import { createOutboxPublisher, type EventPublisher } from '#src/events/outbox-publisher.js';
import { backendPid, waitUntilBlockedBy } from '#tests/support/wait-for-lock-wait.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const MARK = `ci-portal-race-${Date.now()}`;
const tenant = await owner.tenant.create({ data: { name: MARK } });
const T = tenant.id;
const role = await owner.role.create({ data: { tenantId: T, slug: `${MARK}-role`, name: 'role' } });
const agent = await owner.agent.create({
  data: { tenantId: T, roleId: role.id, email: `${MARK}@example.test`, name: '管理者', passwordHash: 'x' },
});
const deps = { prisma: tenantDb };
/** 事件只寫 outbox，commit 後不送進 Redis */
const noDispatch: EventPublisher = { write: createOutboxPublisher(tenantDb).write, dispatch: async () => {} };

afterAll(async () => {
  await owner.outbox.deleteMany({ where: { tenantId: T } });
  await owner.pointTransaction.deleteMany({ where: { tenantId: T } });
  await owner.portalSubmission.deleteMany({ where: { tenantId: T } });
  await owner.portalActivity.deleteMany({ where: { tenantId: T } });
  await owner.contactMergeLog.deleteMany({ where: { tenantId: T } });
  await owner.contact.updateMany({ where: { tenantId: T }, data: { mergedIntoId: null } });
  await owner.contact.deleteMany({ where: { tenantId: T } });
  await owner.agent.deleteMany({ where: { tenantId: T } });
  await owner.role.deleteMany({ where: { tenantId: T } });
  await owner.tenant.delete({ where: { id: T } });
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

/** 在一個交易內寫一筆積分（不經後台的聯絡人檢查，可以指定 contactId 的寫法與寫入時間） */
const addPoints = (input: Parameters<typeof addPointTransaction>[1]) =>
  inTenant(tenantDb, T, (scope) => addPointTransaction(scope, input));

const newContact = (name: string) => owner.contact.create({ data: { tenantId: T, displayName: `${MARK}-${name}` } });
const newActivity = (status: 'DRAFT' | 'PUBLISHED', settings: Record<string, unknown> = {}) =>
  owner.portalActivity.create({
    data: {
      tenantId: T,
      createdById: agent.id,
      type: 'POLL',
      status,
      title: `${MARK}-活動`,
      settings: settings as never,
      options: { create: [{ label: '甲' }] },
    },
    include: { options: true },
  });

/**
 * 交易 1：執行 fn 後停在 commit 之前，直到呼叫 release()。
 * pid 是交易 1 的連線，done 在交易 1 結束後 resolve。
 */
async function pausedTx(fn: (scope: TenantScope) => Promise<unknown>) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let ready!: (pid: number) => void;
  const pid = new Promise<number>((r) => (ready = r));
  const done = inTenant(tenantDb, T, async (scope) => {
    await fn(scope);
    ready(await backendPid(scope.tx));
    await gate;
  });
  done.catch(() => ready(-1));
  return { pid: await pid, release, done };
}

/** 交易 2 卡在交易 1 的鎖上回 'blocked'；沒有卡住、直接結束回 'finished' */
async function blockedOrFinished(blockerPid: number, second: Promise<unknown>) {
  return Promise.race([
    waitUntilBlockedBy(owner, blockerPid).then(() => 'blocked' as const),
    second.then(
      () => 'finished' as const,
      () => 'finished' as const,
    ),
  ]);
}

// ─── 1. 送出活動 ────────────────────────────────────────────────────────────

test('同一位粉絲同時送出兩次', async () => {
  const activity = await newActivity('PUBLISHED', { pointsPerSubmit: 5 });
  const contact = await newContact('重複送出');
  const answers = { optionIds: [activity.options[0].id] };

  const first = await pausedTx((scope) => submitActivity(scope, activity.id, contact.id, answers));
  const second = submitActivityFlow({ prisma: tenantDb, events: noDispatch }, { tenantId: T, contactId: contact.id }, activity.id, answers);
  second.catch(() => {});
  try {
    assert.equal(await blockedOrFinished(first.pid, second), 'blocked', '第二次送出要等第一次 commit');
  } finally {
    first.release();
  }
  await first.done;

  await assert.rejects(second, (err: { code?: string }) => err.code === 'ALREADY_SUBMITTED');
  assert.equal(await owner.portalSubmission.count({ where: { contactId: contact.id } }), 1);
  assert.equal(await owner.pointTransaction.count({ where: { contactId: contact.id } }), 1);
});

test('同時送出時，活動 id 的大小寫不同', async () => {
  const activity = await newActivity('PUBLISHED', { pointsPerSubmit: 5 });
  const contact = await newContact('大寫送出');
  const answers = { optionIds: [activity.options[0].id] };

  const first = await pausedTx((scope) => submitActivity(scope, activity.id, contact.id, answers));
  const second = submitActivityFlow(
    { prisma: tenantDb, events: noDispatch },
    { tenantId: T, contactId: contact.id },
    activity.id.toUpperCase(),
    answers,
  );
  second.catch(() => {});
  try {
    assert.equal(await blockedOrFinished(first.pid, second), 'blocked', 'id 大小寫不同仍是同一把鎖');
  } finally {
    first.release();
  }
  await first.done;

  await assert.rejects(second, (err: { code?: string }) => err.code === 'ALREADY_SUBMITTED');
  assert.equal(await owner.portalSubmission.count({ where: { contactId: contact.id } }), 1);
});

// ─── 2. 積分帳本 ────────────────────────────────────────────────────────────

test('同時寫同一位聯絡人的積分', async () => {
  const contact = await newContact('積分');
  const first = await pausedTx((scope) => addPointTransaction(scope, { contactId: contact.id, amount: 10, type: 'admin_adjust' }));
  const second = adjustPointsFlow(deps, T, { contactId: contact.id, amount: 3 });
  second.catch(() => {});
  try {
    assert.equal(await blockedOrFinished(first.pid, second), 'blocked', '第二筆要等第一筆 commit');
  } finally {
    first.release();
  }
  await first.done;
  assert.equal((await second).balance, 13);

  const rows = await owner.pointTransaction.findMany({ where: { contactId: contact.id }, orderBy: { createdAt: 'desc' } });
  assert.deepEqual(rows.map((r) => r.balance), [13, 10], '最新一筆是後寫入的那筆');
});

test('同時寫入時，聯絡人 id 的大小寫不同', async () => {
  const contact = await newContact('大寫積分');
  const first = await pausedTx((scope) => addPointTransaction(scope, { contactId: contact.id, amount: 10, type: 'admin_adjust' }));
  const second = addPoints({ contactId: contact.id.toUpperCase(), amount: 3, type: 'admin_adjust' });
  second.catch(() => {});
  try {
    assert.equal(await blockedOrFinished(first.pid, second), 'blocked', 'id 大小寫不同仍是同一把鎖');
  } finally {
    first.release();
  }
  await first.done;
  assert.equal((await second).balance, 13);
});

test('同一毫秒內連續寫入', async () => {
  const contact = await newContact('同一毫秒');
  const at = new Date(Date.now() + 60_000);
  // 指定同一個時間寫入兩筆：後一筆要排在前一筆之後，否則「最新一筆」不確定
  await addPoints({ contactId: contact.id, amount: 1, type: 'admin_adjust', createdAt: at });
  await addPoints({ contactId: contact.id, amount: 1, type: 'admin_adjust', createdAt: at });
  await addPoints({ contactId: contact.id, amount: 1, type: 'admin_adjust', createdAt: at });

  const rows = await owner.pointTransaction.findMany({ where: { contactId: contact.id }, orderBy: { createdAt: 'desc' } });
  assert.deepEqual(rows.map((r) => r.balance), [3, 2, 1]);
  assert.equal(new Set(rows.map((r) => r.createdAt.getTime())).size, 3, '三筆的時間都不同');
});

test('調整積分還沒 commit 時合併聯絡人', async () => {
  const merged = await newContact('被合併');
  const survivor = await newContact('保留');
  await addPoints({ contactId: merged.id, amount: 10, type: 'admin_adjust' });

  const first = await pausedTx((scope) => addPointTransaction(scope, { contactId: merged.id, amount: 5, type: 'admin_adjust' }));
  const second = inTenant(tenantDb, T, (scope) =>
    mergeContacts(scope, { survivorId: survivor.id, mergedId: merged.id, source: 'MANUAL', actorAgentId: agent.id }),
  );
  second.catch(() => {});
  try {
    assert.equal(await blockedOrFinished(first.pid, second), 'blocked', '合併要等調整 commit 後才讀餘額');
  } finally {
    first.release();
  }
  await first.done;
  await second;

  const latest = (contactId: string) =>
    owner.pointTransaction.findFirst({ where: { contactId }, orderBy: { createdAt: 'desc' } });
  assert.equal((await latest(merged.id))?.balance, 0, '被合併方的積分全部轉出');
  assert.equal((await latest(survivor.id))?.balance, 15);
});

test('扣點還沒 commit 時解除合併', async () => {
  const merged = await newContact('解除-被合併');
  const survivor = await newContact('解除-保留');
  await addPoints({ contactId: merged.id, amount: 10, type: 'admin_adjust' });
  const { mergeLogId } = await inTenant(tenantDb, T, (scope) =>
    mergeContacts(scope, { survivorId: survivor.id, mergedId: merged.id, source: 'MANUAL', actorAgentId: agent.id }),
  );

  const first = await pausedTx((scope) => addPointTransaction(scope, { contactId: survivor.id, amount: -8, type: 'admin_adjust' }));
  const second = inTenant(tenantDb, T, (scope) => revertMerge(scope, { mergeLogId, revertedBy: agent.id }));
  second.catch(() => {});
  try {
    assert.equal(await blockedOrFinished(first.pid, second), 'blocked', '解除合併要等扣點 commit 後才讀餘額');
  } finally {
    first.release();
  }
  await first.done;
  await second;

  const latest = (contactId: string) =>
    owner.pointTransaction.findFirst({ where: { contactId }, orderBy: { createdAt: 'desc' } });
  assert.equal((await latest(survivor.id))?.balance, 0, '保留方不會被扣成負數');
  assert.equal((await latest(merged.id))?.balance, 2, '只轉回剩下的 2 點');
});

// ─── 3. 抽獎 ────────────────────────────────────────────────────────────────

test('同時抽獎', async () => {
  const activity = await newActivity('PUBLISHED', { allowMultiple: true });
  for (const name of ['甲', '乙', '丙']) {
    const contact = await newContact(`抽獎${name}`);
    await owner.portalSubmission.create({ data: { tenantId: T, activityId: activity.id, contactId: contact.id } });
  }

  let firstWinners: Array<{ id: string }> = [];
  const first = await pausedTx(async (scope) => {
    firstWinners = await drawWinners(scope, activity.id, 2);
  });
  const second = drawWinnersFlow(deps, T, activity.id, 2);
  second.catch(() => {});
  try {
    await blockedOrFinished(first.pid, second);
  } finally {
    first.release();
  }
  await first.done;

  const secondWinners = await second;
  const firstIds = new Set(firstWinners.map((w) => w.id));
  assert.equal(firstWinners.length, 2);
  assert.ok(secondWinners.every((w) => !firstIds.has(w.id)), '第二次抽獎不會抽到第一次的中獎者');
  assert.equal(secondWinners.length, 1, '只剩一位沒中獎');
  assert.equal(await owner.portalSubmission.count({ where: { activityId: activity.id, isWinner: true } }), 3);
});

// ─── 4. 活動狀態 ────────────────────────────────────────────────────────────

const whilePublishing = [
  {
    name: '編輯',
    run: (id: string) => updateActivityFlow(deps, T, id, { options: [{ label: '換掉' }] }),
  },
  { name: '刪除', run: (id: string) => deleteActivityFlow(deps, T, id) },
  { name: '封存', run: (id: string) => archiveActivityFlow(deps, T, id) },
  { name: '再發布一次', run: (id: string) => publishActivityFlow(deps, T, id) },
];

for (const { name, run } of whilePublishing) {
  test(`發布還沒 commit 時編輯、刪除、封存或再發布一次：${name}`, async () => {
    const activity = await newActivity('DRAFT');
    const first = await pausedTx((scope) => publishActivity(scope, activity.id));
    const second = run(activity.id);
    second.catch(() => {});
    try {
      assert.equal(await blockedOrFinished(first.pid, second), 'blocked');
    } finally {
      first.release();
    }
    await first.done;

    await assert.rejects(second, (err: { code?: string; statusCode?: number }) => {
      assert.equal(err.code, 'INVALID_ACTIVITY_STATUS');
      assert.equal(err.statusCode, 409);
      return true;
    });
    const after = await owner.portalActivity.findUnique({ where: { id: activity.id }, include: { options: true } });
    assert.equal(after?.status, 'PUBLISHED');
    assert.deepEqual(after?.options.map((o) => o.id), activity.options.map((o) => o.id), '選項沒有被換掉');
  });
}

test('編輯還沒 commit 時發布', async () => {
  const activity = await newActivity('DRAFT');
  const first = await pausedTx((scope) => updateActivity(scope, activity.id, { options: [{ label: '新選項' }] }));
  const second = publishActivityFlow(deps, T, activity.id);
  second.catch(() => {});
  try {
    assert.equal(await blockedOrFinished(first.pid, second), 'blocked');
  } finally {
    first.release();
  }
  await first.done;
  assert.equal((await second)?.status, 'PUBLISHED');

  const after = await owner.portalActivity.findUnique({ where: { id: activity.id }, include: { options: true } });
  assert.deepEqual(after?.options.map((o) => o.label), ['新選項'], '發布的是編輯後的活動');
});

test('刪除還沒 commit 時封存', async () => {
  const activity = await newActivity('DRAFT');
  const first = await pausedTx((scope) => deleteActivity(scope, activity.id));
  const archived = archiveActivityFlow(deps, T, activity.id);
  archived.catch(() => {});
  try {
    await blockedOrFinished(first.pid, archived);
  } finally {
    first.release();
  }
  await first.done;
  const result = await archived.then(
    (value) => value,
    (err: { code?: string }) => ({ rejected: err.code }),
  );
  assert.equal(result, null, '活動已刪除時回找不到（route 回 404），不是資料庫錯誤');
});
