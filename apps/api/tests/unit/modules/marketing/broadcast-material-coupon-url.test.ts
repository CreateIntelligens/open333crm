/**
 * 沒附券的廣播不可使用含顧客專屬券連結的素材（change improve-coupon-url-insert-ux，
 * spec coupon-management「沒附券的廣播不可使用含顧客專屬券連結的素材」）。
 *
 * {{coupon.url}} 只有附券廣播會代入；一般廣播會把原字送給顧客，顧客拿不到券。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createBroadcast } from '#src/modules/marketing/marketing.service.js';
import { AppError } from '#src/shared/utils/response.js';

const TENANT = 'a0000000-0000-0000-0000-000000000001';
const CHANNEL = '00000000-0000-4000-8000-000000000001';
const MATERIAL = '00000000-0000-4000-8000-000000000002';
const COUPON = '00000000-0000-4000-8000-000000000003';

function mockDb(text: string) {
  const created: unknown[] = [];
  const db = {
    material: {
      findFirst: async (args: { where: { tenantId: string } }) => {
        assert.equal(args.where.tenantId, TENANT, '只查自己租戶的素材');
        return { id: MATERIAL, channelType: 'line', contentType: 'line_text', body: { text } };
      },
    },
    messageTemplate: { findFirst: async () => null },
    channel: { findFirst: async () => ({ id: CHANNEL, channelType: 'LINE' }) },
    campaign: { findFirst: async () => null },
    segment: { findFirst: async () => null },
    coupon: { findFirst: async () => ({ id: COUPON, status: 'ACTIVE', purpose: 'MARKETING' }) },
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
};

describe('沒附券的廣播不可使用含顧客專屬券連結的素材', () => {
  it('不附券的廣播選了含券連結的素材', async () => {
    const { db, created } = mockDb('秋季優惠：{{coupon.url}}');
    await assert.rejects(
      () => createBroadcast(db as never, TENANT, 'agent-1', input),
      (err: unknown) => err instanceof AppError && err.statusCode === 400 && err.code === 'MATERIAL_NEEDS_COUPON'
        && /附上優惠券/.test(err.message),
    );
    assert.equal(created.length, 0, '不建立廣播');
  });

  it('附券廣播可用含券連結的素材', async () => {
    const { db, created } = mockDb('秋季優惠：{{coupon.url}}');
    await createBroadcast(db as never, TENANT, 'agent-1', { ...input, couponId: COUPON });
    assert.equal(created.length, 1);
  });

  it('不含券連結的素材不受影響', async () => {
    const { db, created } = mockDb('秋季優惠開跑');
    await createBroadcast(db as never, TENANT, 'agent-1', input);
    assert.equal(created.length, 1);
  });
});
