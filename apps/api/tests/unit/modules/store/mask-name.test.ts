/**
 * 核銷台顯示的顧客名稱遮罩（store-redemption「查券不改變券的狀態」）。
 */
import assert from 'node:assert/strict';
import { it } from 'vitest';
import { maskCustomerName } from '#src/modules/store/store-console.service.js';

it('保留頭尾字，中間以 ◯ 遮罩', () => {
  assert.equal(maskCustomerName('陳大明'), '陳◯明');
  assert.equal(maskCustomerName('歐陽小明'), '歐◯◯明');
  assert.equal(maskCustomerName('林君'), '林◯');
  assert.equal(maskCustomerName('王'), '王');
  assert.equal(maskCustomerName('Amy Wang'), 'A◯◯◯g');
  assert.equal(maskCustomerName(''), '顧客');
  assert.equal(maskCustomerName(null), '顧客');
});
