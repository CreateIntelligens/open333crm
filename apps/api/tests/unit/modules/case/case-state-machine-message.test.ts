/**
 * 不允許的工單狀態轉換（S05）：錯誤訊息要是中文，客服看得懂下一步。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { validateTransition } from '#src/modules/case/case-state-machine.js';
import { AppError } from '#src/shared/utils/response.js';

test('開啟直接改已解決：422 並以中文說明要先改成處理中', () => {
  try {
    validateTransition('OPEN', 'RESOLVED');
    assert.fail('應拋出錯誤');
  } catch (err) {
    assert.ok(err instanceof AppError);
    assert.equal(err.statusCode, 422);
    assert.equal(err.code, 'INVALID_TRANSITION');
    assert.equal(err.message, '工單狀態不能從「開啟」直接改成「已解決」，可改成：處理中、已關閉');
  }
});
