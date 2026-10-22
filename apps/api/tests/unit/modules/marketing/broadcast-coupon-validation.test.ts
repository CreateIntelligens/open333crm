/**
 * 附券廣播的建立檢查（add-coupon-system A15 15.18，spec「廣播可以附上優惠券」）：
 * 廣播頁只能附進行中的行銷券；不符時回 400，不建立廣播。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createBroadcast } from '#src/modules/marketing/marketing.service.js';
import { AppError } from '#src/shared/utils/response.js';

const TENANT = 'a0000000-0000-0000-0000-000000000001';
const CHANNEL = '00000000-0000-4000-8000-000000000001';
const MATERIAL = '00000000-0000-4000-8000-000000000002';
const COUPON = '00000000-0000-4000-8000-000000000003';

function mockDb(coupon: { status: string; purpose: string | null } | null) {
  const created: unknown[] = [];
  const db = {
    material: { findFirst: async () => ({ id: MATERIAL, channelType: 'line' }) },
    messageTemplate: { findFirst: async () => null },
    channel: { findFirst: async () => ({ id: CHANNEL, channelType: 'LINE' }) },
    campaign: { findFirst: async () => null },
    segment: { findFirst: async () => null },
    coupon: { findFirst: async () => (coupon ? { id: COUPON, name: '秋季九折', ...coupon } : null) },
    broadcast: {
      create: async (args: { data: unknown }) => {
        created.push(args.data);
        return { id: 'b1', ...(args.data as object) };
      },
    },
  };
  return { db, created };
}

const input = {
  name: '秋季廣播',
  materialId: MATERIAL,
  channelId: CHANNEL,
  targetType: 'contacts' as const,
  targetConfig: { contactIds: ['00000000-0000-4000-8000-0000000000c1'] },
  couponId: COUPON,
};

async function expectInvalidCoupon(coupon: { status: string; purpose: string | null } | null) {
  const { db, created } = mockDb(coupon);
  await assert.rejects(
    () => createBroadcast(db as never, TENANT, 'agent-1', input),
    (err: unknown) => err instanceof AppError && err.statusCode === 400 && err.code === 'INVALID_COUPON',
  );
  assert.equal(created.length, 0, '不建立廣播');
}

describe('廣播可以附上優惠券', () => {
  it('附上客服補償券', async () => {
    await expectInvalidCoupon({ status: 'ACTIVE', purpose: 'SERVICE' });
  });

  it('附上草稿券', async () => {
    await expectInvalidCoupon({ status: 'DRAFT', purpose: 'MARKETING' });
  });

  it('券屬於其他租戶（查不到）', async () => {
    await expectInvalidCoupon(null);
  });

  it('附上進行中的行銷券：建立廣播並記下券與發放方式', async () => {
    const { db, created } = mockDb({ status: 'ACTIVE', purpose: 'MARKETING' });
    await createBroadcast(db as never, TENANT, 'agent-1', input);
    assert.equal(created.length, 1);
    const data = created[0] as { couponId: string; couponIssuedVia: string };
    assert.equal(data.couponId, COUPON);
    assert.equal(data.couponIssuedVia, 'broadcast');
  });

  it('附券廣播可以不選素材', async () => {
    const { db, created } = mockDb({ status: 'ACTIVE', purpose: 'MARKETING' });
    await createBroadcast(db as never, TENANT, 'agent-1', { ...input, materialId: undefined });
    assert.equal(created.length, 1);
  });
});
