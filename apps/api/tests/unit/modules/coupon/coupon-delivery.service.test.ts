/**
 * 發券訊息組裝測試（design D7／D10）。純函式，不需 DB。
 */
import assert from 'node:assert/strict';
import { beforeAll, it } from 'vitest';

// buildCouponUrl 讀 WEB_BASE_URL，需先載入設定；env 必填欄位給測試用值
process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.JWT_SECRET ||= 'test-coupon-delivery-jwt-secret';
process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';

const { loadEnvConfig } = await import('#src/config/env.js');
const { buildCouponUrl, buildCouponMessage, requiresClaimToken } = await import(
  '#src/modules/coupon/coupon-delivery.service.js'
);

beforeAll(() => {
  loadEnvConfig();
});

it('帶憑證時連到領取頁', () => {
  const url = buildCouponUrl({ claimToken: 'tok123', instanceId: 'inst456' });
  assert.ok(url.includes('/coupon/claim/tok123'), `連結不正確：${url}`);
});

it('無憑證時直接連到券頁', () => {
  const url = buildCouponUrl({ claimToken: null, instanceId: 'inst456' });
  assert.ok(url.includes('/coupon/inst456'), `連結不正確：${url}`);
  assert.ok(!url.includes('claim'), '不該走領取路徑');
});

it('憑證含特殊字元須編碼', () => {
  const url = buildCouponUrl({ claimToken: 'a/b+c=d', instanceId: 'x' });
  assert.ok(!url.includes('a/b+c=d'), `未編碼：${url}`);
  // 反解後應還原
  const path = new URL(url).pathname;
  const token = decodeURIComponent(path.split('/').pop()!);
  assert.equal(token, 'a/b+c=d');
});

it('LINE 不需要領取憑證', () => {
  assert.equal(requiresClaimToken('LINE'), false);
});

it('FB／IG／其他渠道需要領取憑證', () => {
  for (const ch of ['FB', 'THREADS', 'WEBCHAT']) {
    assert.equal(requiresClaimToken(ch), true, `${ch} 應需要憑證`);
  }
});

it('帶憑證的訊息含勿轉發提示', () => {
  const msg = buildCouponMessage({
    couponName: '折價券', claimToken: 'tok', instanceId: 'i', warnForwarding: true,
  });
  assert.ok(msg.includes('請勿轉發'), '缺少勿轉發提示');
  assert.ok(msg.includes('折價券'), '缺少券名');
  assert.ok(msg.includes('領取'), '缺少領取引導');
});

it('無憑證的訊息不含勿轉發提示', () => {
  const msg = buildCouponMessage({
    couponName: '折價券', claimToken: null, instanceId: 'i', warnForwarding: false,
  });
  assert.ok(!msg.includes('請勿轉發'), '不該有勿轉發提示');
  assert.ok(msg.includes('查看'), '應為查看引導');
});

it('訊息不外洩內部識別以外的資訊', () => {
  const msg = buildCouponMessage({
    couponName: '券', claimToken: 'secret-token', instanceId: 'i', warnForwarding: true,
  });
  // 憑證出現在連結中是必要的，但不應額外以明文重複出現
  const occurrences = msg.split('secret-token').length - 1;
  assert.equal(occurrences, 1, `憑證出現 ${occurrences} 次，應僅在連結中一次`);
});
