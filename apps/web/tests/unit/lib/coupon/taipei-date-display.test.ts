/**
 * 券的日期顯示不受瀏覽器時區影響（add-coupon-system design D17；spec「券的日期一律以台灣時間計算」）。
 * 以 UTC 時區執行：台灣時間與 UTC 的日期不同時，顯示的必須是台灣日期。
 */
process.env.TZ = 'UTC';

import assert from 'node:assert/strict';
import { describe, test, vi } from 'vitest';
import { formatDate, formatDateTime } from '#src/lib/coupon/labels.js';
import { md as issueMd, mdhm as issueMdhm, ymd as issueYmd } from '#src/lib/coupon/issue.js';
import { md as fanMd, mdhm as fanMdhm } from '#src/components/fan-coupon/detail/ui.js';
import { emptyValues, valuesFromCoupon } from '#src/components/coupons/form/form-model.js';

const END = '2026-11-30T15:59:59.999Z'; // 台灣 11/30 23:59
const START = '2026-10-31T16:00:00.000Z'; // 台灣 11/01 00:00

describe('日期顯示不受瀏覽器時區影響', () => {
  test('後台列表與詳情', () => {
    assert.equal(formatDate(END), '2026/11/30');
    assert.equal(formatDate(START), '2026/11/01');
    assert.equal(formatDateTime(START), '2026-11-01 00:00');
  });

  test('對話發券', () => {
    assert.equal(issueMd(START), '11/01');
    assert.equal(issueYmd(START), '2026/11/01');
    assert.equal(issueMdhm(START), '11/01 00:00');
  });

  test('顧客票券頁', () => {
    assert.equal(fanMd(START), '11/1');
    assert.equal(fanMdhm(START), '11-01 00:00');
  });

  test('編輯券時表單帶回台灣日期', () => {
    const v = valuesFromCoupon({ startAt: START, endAt: END, validityMode: 'FIXED', status: 'ACTIVE' } as never);
    assert.equal(v.startAt, '2026-11-01');
    assert.equal(v.endAt, '2026-11-30');
  });

  test('預設生效日是台灣的今天', () => {
    // 台灣 11/01 01:00，UTC 還是 10/31
    vi.useFakeTimers({ now: new Date('2026-10-31T17:00:00.000Z'), toFake: ['Date'] });
    try {
      assert.equal(emptyValues().startAt, '2026-11-01');
    } finally {
      vi.useRealTimers();
    }
  });
});
