/**
 * 票券連結（add-coupon-system「票券連結」、design D12）。API 與 workers 共用。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  issueWalletToken,
  readWalletToken,
  walletLinkUrl,
  buildCouponMessage,
  WALLET_LINK_TTL_MS,
  type WalletTokenStore,
} from '#src/coupon/wallet-link.js';

function memStore(clock: { now: number }): WalletTokenStore {
  const m = new Map<string, { v: string; exp: number }>();
  return {
    async set(k, v, _mode, ttl, _nx) {
      const e = m.get(k);
      if (e && e.exp > clock.now) return null;
      m.set(k, { v, exp: clock.now + ttl });
      return 'OK';
    },
    async get(k) {
      const e = m.get(k);
      return e && e.exp > clock.now ? e.v : null;
    },
  };
}

const payload = {
  tenantId: 't1', contactId: 'c1', channelIdentityId: 'ci1', channelId: 'ch1', conversationId: 'cv1', instanceId: 'i1',
};

describe('票券連結', () => {
  it('開啟有效連結：7 天內可重複讀取', async () => {
    const clock = { now: Date.now() };
    const store = memStore(clock);
    const token = await issueWalletToken(store, payload, () => clock.now);
    assert.match(token, /^[A-Za-z0-9_-]{40,}$/);
    clock.now += WALLET_LINK_TTL_MS - 60_000;
    assert.deepEqual(await readWalletToken(store, token), { ...payload, issuedAt: clock.now - WALLET_LINK_TTL_MS + 60_000 });
    assert.ok(await readWalletToken(store, token), '第二次讀取也要成功');
  });

  it('連結過期', async () => {
    const clock = { now: Date.now() };
    const store = memStore(clock);
    const token = await issueWalletToken(store, payload, () => clock.now);
    clock.now += 8 * 24 * 60 * 60 * 1000;
    assert.equal(await readWalletToken(store, token), null);
  });

  it('不存在或格式不符的權杖回 null', async () => {
    const store = memStore({ now: Date.now() });
    assert.equal(await readWalletToken(store, 'nope'), null);
    assert.equal(await readWalletToken(store, '../../etc/passwd'), null);
  });

  it('發券訊息帶券名與票券連結，不含條款', () => {
    const url = walletLinkUrl('https://crm.example.com/', 'tok_123');
    assert.equal(url, 'https://crm.example.com/coupon/open/tok_123');
    const text = buildCouponMessage({ couponName: '秋季回饋', url });
    assert.ok(text.includes('秋季回饋'));
    assert.ok(text.includes(url));
  });
});
