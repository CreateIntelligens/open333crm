/**
 * 領券自動貼標與發放來源名稱（add-coupon-system「領券時自動貼標」）。
 * 對話發券（API）與關鍵字、加好友自動化發券（workers）共用，兩條路徑行為一致。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { applyCouponClaimTag, couponSourceName } from '#src/coupon/issue.js';

const T = 'a0000000-0000-4000-8000-000000000001';
const DAY = 24 * 60 * 60 * 1000;

function mockTx(tag: { id: string; name: string } | null) {
  const calls: { tagWhere?: unknown; upsert?: Record<string, any> } = {};
  const tx = {
    tag: {
      findFirst: async (args: { where: unknown }) => {
        calls.tagWhere = args.where;
        return tag;
      },
    },
    contactTag: {
      // 尚未貼過這個標籤
      findUnique: async () => null,
      upsert: async (args: Record<string, any>) => {
        calls.upsert = args;
        return {};
      },
    },
  };
  return { tx: tx as never, calls };
}

describe('領券時自動貼標', () => {
  it('券設定了標籤與時效：貼上標籤並寫入到期時間，來源為 system', async () => {
    const { tx, calls } = mockTx({ id: 'tag1', name: '秋季活動' });
    const now = Date.UTC(2026, 9, 21);
    const r = await applyCouponClaimTag(tx, T, 'contact1', { claimTagId: 'tag1', claimTagTtlDays: 7 }, now);
    assert.deepEqual(r, { tagId: 'tag1', tagName: '秋季活動' });
    assert.deepEqual(calls.tagWhere, { id: 'tag1', tenantId: T, scope: 'CONTACT' });
    assert.equal(calls.upsert?.create.addedBy, 'system');
    assert.equal(calls.upsert?.create.expiresAt.getTime(), now + 7 * DAY);
    assert.equal(calls.upsert?.update.expiresAt.getTime(), now + 7 * DAY);
  });

  it('標籤不屬於這個租戶：不貼', async () => {
    const { tx, calls } = mockTx(null);
    const r = await applyCouponClaimTag(tx, T, 'contact1', { claimTagId: 'other', claimTagTtlDays: null });
    assert.equal(r, null);
    assert.equal(calls.upsert, undefined);
  });

  it('券沒有設定標籤：不貼', async () => {
    const { tx, calls } = mockTx({ id: 'tag1', name: 'x' });
    assert.equal(await applyCouponClaimTag(tx, T, 'contact1', { claimTagId: null, claimTagTtlDays: null }), null);
    assert.equal(calls.tagWhere, undefined);
  });
});

describe('發放來源名稱', () => {
  it('依發放方式給預設名稱', () => {
    assert.equal(couponSourceName('inbox'), '對話發券');
    assert.equal(couponSourceName('keyword'), '關鍵字');
    // workers 以觸發事件名稱當發放方式
    assert.equal(couponSourceName('keyword.matched'), '關鍵字');
    assert.equal(couponSourceName('message.received'), '自動化');
    assert.equal(couponSourceName('automation'), '自動化');
    // design D32：加好友禮、發券 API 沒有個別名稱時的預設
    assert.equal(couponSourceName('follow'), '加好友');
    assert.equal(couponSourceName('api'), 'API');
    // 群發、活動等有自己名稱的來源由呼叫端傳入
    assert.equal(couponSourceName('broadcast'), undefined);
    assert.equal(couponSourceName(null), undefined);
  });
});

describe('券號比對鍵', () => {
  it('忽略連字號、空白、大小寫，全形英數字視同半形', async () => {
    const { couponCodeKey } = await import('#src/coupon/issue.js');
    assert.equal(couponCodeKey('autumn-r9xu x9rg'), 'AUTUMNR9XUX9RG');
    assert.equal(couponCodeKey('ＡＵＴＵＭＮ－Ｒ９ＸＵ'), 'AUTUMNR9XU');
  });
});
