/**
 * 券的 advisory lock 不受 id 大小寫影響（issue #403）。
 *
 * 結束券與發券以同一把鎖互斥：結束要等進行中的發券 commit 之後才作廢未使用的券，
 * 否則剛發出的券不會被作廢（主規格 coupon-management「停用券使已發出的券失效」）。
 * 鎖鍵是字串，PostgreSQL 比對 uuid 不分大小寫，字串卻分大小寫；
 * 修正前，大寫 id 與小寫 id 拿到兩把不同的鎖，結束不用等發券。
 *
 * 交易 1 停在 commit 之前，交易 2 開始後以 pg_blocking_pids 確認交易 2 卡在交易 1 的鎖上，再放開交易 1。
 * 屬於 feature 組：需要真的 PostgreSQL 才能重現並行。本檔的券以 createdById 標記、聯絡人以 displayName 標記，
 * 於 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { inTenant, type TenantScope } from '#src/lib/tenant-ctx.js';
import { changeStatus } from '#src/modules/coupon/coupon-lifecycle.service.js';
import { issueCoupons } from '#src/modules/coupon/coupon-issue.service.js';
import { backendPid, waitUntilBlockedBy } from '#tests/support/wait-for-lock-wait.js';
import { TENANT_A } from '#tests/setup/feature-config.js';

loadEnvConfig();
const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = TENANT_A;
const MARK = `coupon-lock-case-${Date.now()}`;
/** 本檔所有券的 createdById，也是清理時的標記 */
const creatorId = randomUUID();

afterAll(async () => {
  // coupon_instances 隨 coupons 串聯刪除
  await owner.coupon.deleteMany({ where: { tenantId: T, createdById: creatorId } });
  const contacts = { tenantId: T, displayName: { startsWith: MARK } };
  await owner.contactTag.deleteMany({ where: { contact: contacts } });
  await owner.contact.deleteMany({ where: contacts });
  await owner.$disconnect();
  await tenantDb.$disconnect();
});

const newContact = (name: string) => owner.contact.create({ data: { tenantId: T, displayName: `${MARK}-${name}` } });

/** 進行中、共用券碼的贈品券（直接以 owner 建立，略過發布驗證） */
let seq = 0;
const newActiveCoupon = () => {
  const n = `${Date.now().toString(36).slice(-5).toUpperCase()}${seq++}`;
  return owner.coupon.create({
    data: {
      tenantId: T,
      name: `${MARK}-券`,
      displayCode: `CP-LK${n}`,
      couponType: 'GIFT',
      giftName: '贈品',
      giftQty: 1,
      purpose: 'MARKETING',
      validityMode: 'AFTER_CLAIM',
      afterClaimDays: 30,
      codeMode: 'SHARED_CODE',
      sharedCode: `LOCK${n}`,
      redeemMode: 'SELF',
      status: 'ACTIVE',
      createdById: creatorId,
    },
  });
};

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

/**
 * 交易 1 以 issueId 發券並停在 commit 之前，同時以 endId 結束券。
 * 結束必須等發券 commit，結束後這次發出的券要被作廢。
 */
async function endWhileIssuing(issueId: (id: string) => string, endId: (id: string) => string) {
  const coupon = await newActiveCoupon();
  const contact = await newContact('顧客');

  const first = await pausedTx((scope) => issueCoupons(scope, issueId(coupon.id), { contactIds: [contact.id] }));
  const second = inTenant(tenantDb, T, (scope) => changeStatus(scope, endId(coupon.id), 'ENDED'));
  second.catch(() => {});
  try {
    assert.equal(await blockedOrFinished(first.pid, second), 'blocked', '結束券要等進行中的發券 commit');
  } finally {
    first.release();
  }
  await first.done;

  const ended = await second;
  assert.ok(ended.ok, `結束失敗：${JSON.stringify(ended)}`);
  const instances = await owner.couponInstance.findMany({ where: { couponId: coupon.id }, select: { status: true } });
  assert.equal(instances.length, 1);
  assert.equal(instances[0].status, 'REVOKED', '結束後，結束前發出的券要被作廢');
}

/**
 * 交易 1 以 endId 結束券並停在 commit 之前，同時以 issueId 發券。
 * 發券必須等結束 commit 之後才讀狀態，讀到已結束就拒絕，不留下任何券。
 */
async function issueWhileEnding(endId: (id: string) => string, issueId: (id: string) => string) {
  const coupon = await newActiveCoupon();
  const contact = await newContact('顧客');

  const first = await pausedTx((scope) => changeStatus(scope, endId(coupon.id), 'ENDED'));
  const second = inTenant(tenantDb, T, (scope) => issueCoupons(scope, issueId(coupon.id), { contactIds: [contact.id] }));
  second.catch(() => {});
  try {
    assert.equal(await blockedOrFinished(first.pid, second), 'blocked', '發券要等進行中的結束 commit');
  } finally {
    first.release();
  }
  await first.done;

  await assert.rejects(second, /僅能發放進行中的券/);
  assert.equal(await owner.couponInstance.count({ where: { couponId: coupon.id } }), 0, '已結束的券不可再發出');
}

test('以大寫 id 結束券時，要等以小寫 id 進行中的發券', async () => {
  await endWhileIssuing((id) => id.toLowerCase(), (id) => id.toUpperCase());
});

test('以小寫 id 結束券時，要等以大寫 id 進行中的發券', async () => {
  await endWhileIssuing((id) => id.toUpperCase(), (id) => id.toLowerCase());
});

test('以大寫 id 結束券時，以小寫 id 發券要等結束 commit', async () => {
  await issueWhileEnding((id) => id.toUpperCase(), (id) => id.toLowerCase());
});

test('以小寫 id 結束券時，以大寫 id 發券要等結束 commit 之後才讀狀態', async () => {
  await issueWhileEnding((id) => id.toLowerCase(), (id) => id.toUpperCase());
});
