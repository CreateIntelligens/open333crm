/**
 * 列出租戶全部可用的領券連結（change improve-coupon-url-insert-ux，spec coupon-management
 * 「列出租戶全部可用的領券連結」）。素材編輯器的「插入領券連結」用這份清單。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { listAvailableClaimLinks } from '#src/modules/coupon/coupon-claim-link.service.js';

const T = 'a0000000-0000-0000-0000-000000000001';
const OTHER = 'b0000000-0000-0000-0000-000000000002';
const NOW = new Date('2026-10-28T08:00:00Z');
const BASE = 'https://crm.example.com';

const channel = { id: 'ch-1', channelType: 'LINE', displayName: 'LINE 官方帳號', settings: { basicId: '@shop' }, isActive: true };
const fbChannel = { id: 'ch-2', channelType: 'FB', displayName: '本店粉專', settings: { pageId: '123' }, isActive: true };
const row = (id: string, tenantId: string, extra: Record<string, unknown> = {}) => ({
  id, tenantId, couponId: 'c-1', name: id, code: `CODE${id.toUpperCase()}`, status: 'ACTIVE',
  startAt: null, endAt: null, openCount: 0, claimCount: 0, createdAt: NOW,
  channel, coupon: { name: '秋季九折', status: 'ACTIVE' }, ...extra,
});

const rows = [
  row('a', T),
  row('b', T, { status: 'DISABLED' }),
  row('c', T, { coupon: { name: '暫停券', status: 'PAUSED' } }),
  row('d', T, { endAt: new Date('2026-10-01T00:00:00Z') }),
  row('e', T, { endAt: new Date('2026-12-31T00:00:00Z') }),
  row('x', OTHER),
  row('f', T, { channel: fbChannel }),
];

/** 模擬 Prisma 依 where 篩選：tenantId、連結狀態、券狀態、結束時間 */
function fakeCtx() {
  const calls: Array<Record<string, any>> = [];
  const tx = {
    couponClaimLink: {
      findMany: async (args: Record<string, any>) => {
        calls.push(args);
        const w = args.where;
        return rows.filter((r) => {
          if (r.tenantId !== w.tenantId) return false;
          if (w.status && r.status !== w.status) return false;
          if (w.coupon?.status && r.coupon.status !== w.coupon.status) return false;
          if (w.channel?.channelType && r.channel.channelType !== w.channel.channelType) return false;
          if (w.OR) {
            const ok = w.OR.some((c: Record<string, any>) =>
              (c.endAt === null && r.endAt === null) || (c.endAt?.gt && r.endAt && (r.endAt as Date) > c.endAt.gt));
            if (!ok) return false;
          }
          return true;
        });
      },
    },
  };
  return { ctx: { tx: tx as never, tenantId: T }, calls };
}

test('只列出可用的連結：啟用、券進行中、沒有結束', async () => {
  const { ctx } = fakeCtx();
  const links = await listAvailableClaimLinks(ctx, BASE, {}, NOW);
  assert.deepEqual(links.map((l) => l.id), ['a', 'e', 'f']);
  assert.equal(links[0]!.couponName, '秋季九折');
  assert.equal(links[0]!.url, `${BASE}/coupon/claim/CODEA`);
  assert.equal(links[0]!.channel.displayName, 'LINE 官方帳號');
});

test('只列出同租戶的連結', async () => {
  const { ctx, calls } = fakeCtx();
  const links = await listAvailableClaimLinks(ctx, BASE, {}, NOW);
  assert.equal(calls[0]!.where.tenantId, T, '查詢條件要帶租戶');
  assert.ok(!links.some((l) => l.id === 'x'));
});

test('只列出指定渠道的連結', async () => {
  const { ctx } = fakeCtx();
  assert.deepEqual((await listAvailableClaimLinks(ctx, BASE, { channelType: 'FB' }, NOW)).map((l) => l.id), ['f']);
  assert.deepEqual((await listAvailableClaimLinks(ctx, BASE, { channelType: 'LINE' }, NOW)).map((l) => l.id), ['a', 'e']);
});
