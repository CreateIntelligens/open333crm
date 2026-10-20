/**
 * Account Link 的純函式部分（nonce 產生、連動網址組裝），不需 Redis。
 * nonce 的存取與一次性消費需要真實 Redis，在 tests/feature/modules/fan-auth/fan-auth.test.ts。
 */
import assert from 'node:assert/strict';
import { it } from 'vitest';
import { generateNonce, buildAccountLinkUrl } from '#src/modules/fan-auth/account-link.service.js';

it('nonce 為 CSPRNG 且長度足夠（≥128 bit）', () => {
  const n = generateNonce();
  // base64url 編碼 32 bytes → 43 字元
  assert.ok(n.length >= 22, `nonce 過短：${n.length} 字元`);
  const seen = new Set(Array.from({ length: 500 }, () => generateNonce()));
  assert.equal(seen.size, 500, 'nonce 出現重複，亂數來源可疑');
});

it('連動網址格式正確且參數已編碼', () => {
  const url = buildAccountLinkUrl('tok+en/123', 'non+ce/456');
  assert.ok(url.startsWith('https://access.line.me/dialog/bot/accountLink?'), '網址前綴不正確');
  assert.ok(!url.includes('tok+en/123'), '參數未經編碼');
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('linkToken'), 'tok+en/123');
  assert.equal(parsed.searchParams.get('nonce'), 'non+ce/456');
});
