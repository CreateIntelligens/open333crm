/**
 * 券的日期以台灣時間計算（add-coupon-system design D17）。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { afterClaimExpiry, parseDateOnly, taipeiDateEnd, taipeiDateStart, taipeiDateString, taipeiDatesBetween } from '#src/coupon/taipei-time.js';

describe('固定效期的起訖以台灣時間計算', () => {
  test('生效日從台灣時間 00:00 起算', () => {
    assert.equal(taipeiDateStart('2026-11-01').toISOString(), '2026-10-31T16:00:00.000Z');
  });
  test('失效日到台灣時間 23:59:59.999 為止', () => {
    assert.equal(taipeiDateEnd('2026-11-30').toISOString(), '2026-11-30T15:59:59.999Z');
  });
  test('格式不對回 null', () => {
    assert.equal(parseDateOnly('2026/11/30'), null);
    assert.equal(parseDateOnly('2026-02-30'), null);
    assert.equal(parseDateOnly('2026-11-30'), '2026-11-30');
  });
});

describe('領取後 N 天到期以台灣日期計算', () => {
  test('台灣時間 23:30 領取，3 天後當天結束到期', () => {
    const claimedAt = new Date('2026-11-01T15:30:00.000Z'); // 台灣 11/01 23:30
    assert.equal(afterClaimExpiry(claimedAt, 3).toISOString(), '2026-11-04T15:59:59.999Z');
  });
  test('UTC 已跨日但台灣還沒：以台灣日期為準', () => {
    const claimedAt = new Date('2026-11-01T00:30:00.000Z'); // 台灣 11/01 08:30
    assert.equal(afterClaimExpiry(claimedAt, 1).toISOString(), '2026-11-02T15:59:59.999Z');
  });
});

describe('台灣日期字串', () => {
  test('UTC 16:00 已是台灣隔天', () => {
    assert.equal(taipeiDateString(new Date('2026-10-31T16:00:00.000Z')), '2026-11-01');
  });
});

describe('期間內每一個台灣日期（taipeiDatesBetween）', () => {
  test('從 from 的台灣日期列到 to 的台灣日期，頭尾不足一天也算', () => {
    // 台灣 2026-11-01 08:00 到 2026-11-03 07:59
    assert.deepEqual(
      taipeiDatesBetween(new Date('2026-11-01T00:00:00.000Z'), new Date('2026-11-02T23:59:00.000Z'), 400),
      ['2026-11-01', '2026-11-02', '2026-11-03'],
    );
  });
  test('UTC 前一天晚上 16:00 起就是台灣隔天', () => {
    assert.deepEqual(
      taipeiDatesBetween(new Date('2026-10-31T16:00:00.000Z'), new Date('2026-11-01T15:59:59.999Z'), 400),
      ['2026-11-01'],
    );
  });
  test('from 晚於 to 回空陣列', () => {
    assert.deepEqual(taipeiDatesBetween(new Date('2026-11-05T00:00:00.000Z'), new Date('2026-11-01T00:00:00.000Z'), 400), []);
  });
  test('超過上限天數回 null', () => {
    assert.equal(taipeiDatesBetween(new Date('2026-11-01T00:00:00.000Z'), new Date('2026-11-05T00:00:00.000Z'), 4), null);
    assert.equal(taipeiDatesBetween(new Date('2026-11-01T00:00:00.000Z'), new Date('2026-11-04T00:00:00.000Z'), 4)?.length, 4);
  });
});
