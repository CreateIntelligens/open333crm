/**
 * 前端統一錯誤處理測試。
 *   npx tsx apps/web/src/lib/api-error.test.ts
 *
 * 重點在「取不到後端訊息時會怎樣」——那是這支 helper 存在的理由。
 */
import assert from 'node:assert/strict';
import { getApiErrorMessage, getFieldErrors, getApiErrorCode } from './api-error.js';

let pass = 0;
let fail = 0;
function t(name: string, fn: () => void) {
  try { fn(); console.log(`PASS  ${name}`); pass++; }
  catch (e) { console.log(`FAIL  ${name}\n      ${(e as Error).message}`); fail++; }
}

const withError = (status: number, error: unknown) => ({ response: { status, data: { error } } });

t('優先使用後端訊息（後端已全面中文化）', () => {
  const m = getApiErrorMessage(withError(404, { code: 'NOT_FOUND', message: '找不到此聯絡人' }));
  assert.equal(m, '找不到此聯絡人');
});

t('⚠️ 不可回退到 error.code（原重複 helper 的 bug）', () => {
  const m = getApiErrorMessage(withError(400, { code: 'VALIDATION_ERROR' }), '儲存失敗');
  assert.ok(!m.includes('VALIDATION_ERROR'), `技術代碼外洩：${m}`);
  assert.equal(m, '輸入內容有誤，請檢查後重試');
});

t('後端沒回訊息時依狀態碼給說明', () => {
  const cases: Array<[number, string]> = [
    [401, '請先登入後再操作'],
    [403, '權限不足，無法執行此操作'],
    [404, '找不到指定的資料，可能已被刪除'],
    [409, '目前狀態無法執行此操作，請重新整理後再試'],
    [429, '操作太頻繁，請稍候再試'],
    [503, '服務暫時無法使用，請稍後重試'],
  ];
  for (const [status, expected] of cases) {
    assert.equal(getApiErrorMessage(withError(status, undefined)), expected, `${status} 不符`);
  }
});

t('5xx 未列舉者回通用系統錯誤', () => {
  assert.equal(getApiErrorMessage(withError(500, undefined)), '系統發生錯誤，請稍後重試');
});

t('網路斷線與逾時有專屬說明', () => {
  assert.equal(getApiErrorMessage({ code: 'ERR_NETWORK' }), '網路連線異常，請檢查網路後重試');
  assert.equal(getApiErrorMessage({ code: 'ECONNABORTED' }), '網路連線異常，請檢查網路後重試');
});

t('完全無法辨識時用呼叫端的 fallback', () => {
  assert.equal(getApiErrorMessage(null, '儲存失敗，請稍後重試'), '儲存失敗，請稍後重試');
  assert.equal(getApiErrorMessage('壞掉的東西', '匯入失敗'), '匯入失敗');
});

t('訊息不含 HTTP 狀態碼等技術細節', () => {
  for (const s of [400, 403, 404, 500, 503]) {
    const m = getApiErrorMessage(withError(s, undefined));
    assert.ok(!/\d{3}/.test(m), `訊息含狀態碼：${m}`);
  }
});

t('可取出欄位層級的驗證訊息', () => {
  const errs = getFieldErrors(withError(400, {
    code: 'VALIDATION_ERROR',
    details: { issues: [{ path: 'email', message: '電子郵件格式不正確' }] },
  }));
  assert.deepEqual(errs, { email: '電子郵件格式不正確' });
});

t('沒有 issues 時回空物件而非爆掉', () => {
  assert.deepEqual(getFieldErrors(withError(500, undefined)), {});
  assert.deepEqual(getFieldErrors(null), {});
});

t('錯誤碼可供程式判斷分支', () => {
  assert.equal(getApiErrorCode(withError(409, { code: 'ALREADY_CLAIMED' })), 'ALREADY_CLAIMED');
  assert.equal(getApiErrorCode(null), undefined);
});

console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
process.exit(fail > 0 ? 1 : 0);
