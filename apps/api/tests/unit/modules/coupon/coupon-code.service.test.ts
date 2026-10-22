/**
 * 券碼產生與券碼清單解析（純函式，不需 DB）。
 */
import assert from 'node:assert/strict';
import { it } from 'vitest';
import { generateCouponCode, parseCodeList } from '#src/modules/coupon/coupon-code.service.js';

it('券碼避開易混淆字元 0/O/1/I/L', () => {
  for (let i = 0; i < 200; i += 1) {
    const code = generateCouponCode();
    assert.ok(!/[01OIL]/.test(code), `產生了含混淆字元的碼：${code}`);
  }
});

it('券碼前綴格式不符須拒絕', () => {
  assert.throws(() => generateCouponCode('太長的前綴超過八碼'), /前綴/);
});

it('券碼清單解析可分類有效／重複／格式錯誤', () => {
  const r = parseCodeList('ABCD1234\nABCD1234\nXY\nEFGH5678,IJKL9012');
  assert.deepEqual(r.valid, ['ABCD1234', 'EFGH5678', 'IJKL9012']);
  assert.deepEqual(r.duplicatesInInput, ['ABCD1234']);
  assert.deepEqual(r.invalid, ['XY']);
});

it('只有連字號的序號視為格式錯誤', () => {
  // A-1-2 長度符合但只有 3 個英數字
  const r = parseCodeList('----\nA-1-2\nAB-12\nABCD-1234');
  assert.deepEqual(r.invalid, ['----', 'A-1-2']);
  assert.deepEqual(r.valid, ['AB-12', 'ABCD-1234']);
});
