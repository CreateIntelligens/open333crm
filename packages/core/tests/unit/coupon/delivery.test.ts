/**
 * 發券的確認與作廢（add-coupon-system design D16、D25）。
 * API（對話發券，TenantCtx 的 tx）與 workers（BYPASSRLS 的交易，自帶 tenantId）共用，
 * 所以每個查詢都要自己帶 tenantId，不能靠 RLS。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { confirmPendingInstance, voidPendingInstance } from '#src/coupon/delivery.js';

const T = 'a0000000-0000-4000-8000-000000000001';
const INSTANCE = 'c0000000-0000-4000-8000-0000000000c1';
const COUPON_OF_INSTANCE = 'c0000000-0000-4000-8000-0000000000a1';

function voidTx(pending: boolean) {
  const calls: { raw: unknown[]; codeUpdate?: Record<string, any>; deleteWhere?: unknown } = { raw: [] };
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.raw.push({ sql: strings.join('?'), values });
      return pending ? [{ id: INSTANCE, couponId: COUPON_OF_INSTANCE }] : [];
    },
    couponCode: {
      updateMany: async (args: Record<string, any>) => {
        calls.codeUpdate = args;
        return { count: 1 };
      },
    },
    couponInstance: {
      deleteMany: async (args: { where: unknown }) => {
        calls.deleteWhere = args.where;
        return { count: 1 };
      },
    },
  };
  return { tx: tx as never, calls };
}

describe('作廢發送中的券', () => {
  it('發送中的券：鎖住後歸還序號並刪除，兩個查詢都帶租戶', async () => {
    const { tx, calls } = voidTx(true);
    assert.equal(await voidPendingInstance(tx, T, INSTANCE), true);
    const raw = calls.raw[0] as { sql: string; values: unknown[] };
    assert.match(raw.sql, /FOR UPDATE/);
    assert.match(raw.sql, /"deliveryPendingAt" IS NOT NULL/);
    assert.deepEqual(raw.values, [INSTANCE, T]);
    assert.deepEqual(calls.codeUpdate, {
      where: { tenantId: T, couponId: COUPON_OF_INSTANCE, instanceId: INSTANCE, status: 'ASSIGNED' },
      data: { status: 'AVAILABLE', instanceId: null },
    });
    assert.deepEqual(calls.deleteWhere, { id: INSTANCE, tenantId: T, deliveryPendingAt: { not: null } });
  });

  it('只歸還這張券、這個序號包裡仍為已指派的序號（#362 D13）', async () => {
    const COUPON = 'c0000000-0000-4000-8000-00000000c0a1';
    const codes = [
      { id: 'mine', tenantId: T, couponId: COUPON, instanceId: INSTANCE, status: 'ASSIGNED' },
      // 同一個 instanceId 卻屬於別張券的序號包（資料錯置）：不能被放回別張券的庫存
      { id: 'other-pool', tenantId: T, couponId: 'c0000000-0000-4000-8000-00000000c0b2', instanceId: INSTANCE, status: 'ASSIGNED' },
      // 狀態已不是已指派（例如已被其他流程歸還）：不重複處理
      { id: 'not-assigned', tenantId: T, couponId: COUPON, instanceId: INSTANCE, status: 'AVAILABLE' },
    ];
    const tx = {
      $queryRaw: async () => [{ id: INSTANCE, couponId: COUPON }],
      couponCode: {
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const rows = codes.filter((c) => Object.entries(where).every(([k, v]) => (c as Record<string, unknown>)[k] === v));
          rows.forEach((r) => Object.assign(r, data));
          return { count: rows.length };
        },
      },
      couponInstance: { deleteMany: async () => ({ count: 1 }) },
    };
    assert.equal(await voidPendingInstance(tx as never, T, INSTANCE), true);
    assert.deepEqual(
      codes.map((c) => [c.id, c.status, c.instanceId]),
      [['mine', 'AVAILABLE', null], ['other-pool', 'ASSIGNED', INSTANCE], ['not-assigned', 'AVAILABLE', INSTANCE]],
    );
  });

  it('已確認發出的券（不在發送中）不刪除', async () => {
    const { tx, calls } = voidTx(false);
    assert.equal(await voidPendingInstance(tx, T, INSTANCE), false);
    assert.equal(calls.codeUpdate, undefined);
    assert.equal(calls.deleteWhere, undefined);
  });
});

function confirmTx(opts: { pending: boolean; tag?: { id: string; name: string } | null; tagFails?: boolean }) {
  const calls: { confirmArgs?: Record<string, any>; raw: string[]; upsert?: Record<string, any> } = { raw: [] };
  const tx = {
    $executeRawUnsafe: async (sql: string) => {
      calls.raw.push(sql);
      return 0;
    },
    couponInstance: {
      updateMany: async (args: Record<string, any>) => {
        calls.confirmArgs = args;
        return { count: opts.pending ? 1 : 0 };
      },
    },
    tag: { findFirst: async () => opts.tag ?? null },
    contactTag: {
      findUnique: async () => null,
      upsert: async (args: Record<string, any>) => {
        if (opts.tagFails) throw new Error('連線中斷');
        calls.upsert = args;
        return {};
      },
    },
  };
  return { tx: tx as never, calls };
}

const params = (claimTagId: string | null) => ({
  tenantId: T,
  instanceId: INSTANCE,
  contactId: 'contact1',
  coupon: { claimTagId, claimTagTtlDays: null },
});

describe('確認發出', () => {
  it('清除發送中標記（帶租戶與發送中條件）並貼領券標籤，回傳貼上的標籤', async () => {
    const { tx, calls } = confirmTx({ pending: true, tag: { id: 'tag1', name: '已領券' } });
    const r = await confirmPendingInstance(tx, params('tag1'));
    assert.deepEqual(r, { confirmed: true, tag: { tagId: 'tag1', tagName: '已領券' } });
    assert.deepEqual(calls.confirmArgs, {
      where: { id: INSTANCE, tenantId: T, contactId: 'contact1', deliveryPendingAt: { not: null } },
      data: { deliveryPendingAt: null },
    });
    assert.equal(calls.upsert?.create.contactId, 'contact1');
  });

  it('傳入的聯絡人不是這張券的持有人：視為沒有確認、不貼標（#362 D12）', async () => {
    const instance = { id: INSTANCE, tenantId: T, contactId: 'contact1', deliveryPendingAt: new Date() as Date | null };
    const upserts: unknown[] = [];
    const tx = {
      $executeRawUnsafe: async () => 0,
      couponInstance: {
        updateMany: async ({ where, data }: { where: Record<string, any>; data: Record<string, unknown> }) => {
          const hit = where.id === instance.id && where.tenantId === instance.tenantId &&
            (where.contactId === undefined || where.contactId === instance.contactId) &&
            (where.deliveryPendingAt?.not !== null || instance.deliveryPendingAt !== null);
          if (hit) Object.assign(instance, data);
          return { count: hit ? 1 : 0 };
        },
      },
      tag: { findFirst: async () => ({ id: 'tag1', name: '已領券' }) },
      contactTag: { findUnique: async () => null, upsert: async (args: unknown) => { upserts.push(args); return {}; } },
    };
    const r = await confirmPendingInstance(tx as never, { ...params('tag1'), contactId: 'someone-else' });
    assert.deepEqual(r, { confirmed: false });
    assert.notEqual(instance.deliveryPendingAt, null, '券應維持發送中，交給排程作廢');
    assert.deepEqual(upserts, [], '不可替別人貼領券標籤');
  });

  it('券在確認前已被作廢：不貼標，回報沒有確認', async () => {
    const { tx, calls } = confirmTx({ pending: false, tag: { id: 'tag1', name: '已領券' } });
    assert.deepEqual(await confirmPendingInstance(tx, params('tag1')), { confirmed: false });
    assert.equal(calls.upsert, undefined);
  });

  it('券沒有設定標籤：確認發出，標籤為 null', async () => {
    const { tx, calls } = confirmTx({ pending: true });
    assert.deepEqual(await confirmPendingInstance(tx, params(null)), { confirmed: true, tag: null });
    assert.deepEqual(calls.raw, []);
  });

  it('貼標失敗不影響確認：在 savepoint 內回滾，標籤為 null', async () => {
    const { tx, calls } = confirmTx({ pending: true, tag: { id: 'tag1', name: '已領券' }, tagFails: true });
    assert.deepEqual(await confirmPendingInstance(tx, params('tag1')), { confirmed: true, tag: null });
    assert.deepEqual(calls.raw, ['SAVEPOINT coupon_claim_tag', 'ROLLBACK TO SAVEPOINT coupon_claim_tag']);
  });
});
