/**
 * 優惠券序號明細 CSV（code review 2026-10-21、#423）：持有者名稱來自顧客自訂的 LINE／FB 暱稱，
 * 以 = + - @ 開頭時 Excel 會當成公式執行，要加前置單引號當成文字；含逗號、引號、換行時欄數不變。
 * 儲存格規則本身由 packages/shared/tests/unit/csv.test.ts 測試。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { instancesToCsv } from '#src/modules/coupon/coupon-stats.service.js';
import { parseCsv } from '../../../support/parse-csv.js';

type Row = Parameters<typeof instancesToCsv>[0][number];

function instance(code: string, displayName: string | null, issuedAt: string): Row {
  return {
    code,
    status: 'CLAIMED',
    contact: displayName === null ? null : { displayName },
    issuedVia: 'CONVERSATION',
    issuedAt: new Date(issuedAt),
    claimedAt: null,
    openedAt: null,
    redeemedAt: null,
    redeemMode: null,
    expiresAt: null,
  } as unknown as Row;
}

const EVIL = '=HYPERLINK("http://evil.example","點我, 領獎")';

function exportRows() {
  const csv = instancesToCsv([
    instance('A-1', EVIL, '2026-10-21T03:00:00.000Z'),
    instance('-B2', '王\n小美', '2026-10-20T03:00:00.000Z'),
    instance('C3', null, '2026-10-19T03:00:00.000Z'),
  ]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  return parseCsv(csv.slice(1));
}

test('持有者名稱以公式開頭又含逗號', () => {
  const rows = exportRows();
  assert.equal(rows.length, 4);
  for (const r of rows) assert.equal(r.length, 10);
  assert.equal(rows[0][0], '券號');
  assert.equal(rows[1][2], `'${EVIL}`);
  assert.equal(rows[1][4], '2026-10-21T03:00:00.000Z');
  assert.equal(rows[3][2], '');
});

test('券號以減號開頭、持有者名稱含換行', () => {
  const rows = exportRows();
  for (const r of rows) assert.equal(r.length, 10);
  assert.equal(rows[2][0], "'-B2");
  assert.equal(rows[2][2], '王\n小美');
});
