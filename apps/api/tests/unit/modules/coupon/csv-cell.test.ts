/**
 * 優惠券領取名單 CSV 的儲存格（code review 2026-10-21）：持有者名稱來自顧客自訂的 LINE／FB 暱稱，
 * 以 = + - @ 開頭時 Excel 會當成公式執行，要加前置單引號當成文字。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { csvCell } from '#src/modules/coupon/coupon-stats.service.js';

test('公式開頭的值加上單引號，當成文字', () => {
  assert.equal(csvCell('=HYPERLINK("http://evil","點我")'), `"'=HYPERLINK(""http://evil"",""點我"")"`);
  assert.equal(csvCell('+886912345678'), `"'+886912345678"`);
  assert.equal(csvCell('-1'), `"'-1"`);
  assert.equal(csvCell('@SUM(A1)'), `"'@SUM(A1)"`);
  assert.equal(csvCell('\t=1'), `"'\t=1"`);
});

test('一般值照原樣，引號加倍', () => {
  assert.equal(csvCell('王小美'), '"王小美"');
  assert.equal(csvCell('說"你好"'), '"說""你好"""');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell('2026-10-21T03:00:00.000Z'), '"2026-10-21T03:00:00.000Z"');
});
