/**
 * 核銷台：開啟後計時的券顧客還沒開啟（code review 2026-10-21）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { REDEEM_FAILURE, failureView } from '#src/components/store-console/outcomes.js';

test('核銷回報尚未開啟：請顧客先在手機上開啟', () => {
  const key = REDEEM_FAILURE.NOT_OPENED;
  assert.equal(key, 'notOpened');
  const view = failureView({ key, code: 'ABCD1234' });
  assert.equal(view.title, '尚未開啟');
  assert.match(view.description ?? '', /先在手機上開啟/);
});
