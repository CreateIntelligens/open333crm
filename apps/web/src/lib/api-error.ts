/**
 * 統一解析 API 錯誤成使用者看得懂的訊息。
 *
 * 背景：專案原本沒有共用的錯誤處理——41 處 window.alert()、153 處各頁自畫的
 * setError，另有兩份完全重複貼上的 apiErrorMessage()。其中一份的 fallback 鏈是
 * `message ?? code ?? fallback`，第二層會把 `VALIDATION_ERROR` 這類**錯誤代碼
 * 直接當文案顯示給使用者**。
 *
 * 後端已全面中文化（AppError 英文 239 → 0），所以這裡的首選就是直接用
 * `error.message`；本檔的價值在於處理它取不到的情況：網路斷線、逾時、
 * 非預期回應格式——那些後端根本沒機會回訊息。
 */

/** 後端統一回應格式 { success, error: { code, message, details } }。 */
interface ApiErrorShape {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
}

function extract(err: unknown): { status?: number; error?: ApiErrorShape; isNetwork: boolean } {
  if (!err || typeof err !== 'object') return { isNetwork: false };
  const e = err as {
    response?: { status?: number; data?: { error?: ApiErrorShape } };
    code?: string;
    message?: string;
  };
  // axios 在連不上或逾時的情況下沒有 response
  if (!e.response) {
    const isNetwork =
      e.code === 'ERR_NETWORK' || e.code === 'ECONNABORTED' || e.message === 'Network Error';
    return { isNetwork };
  }
  return { status: e.response.status, error: e.response.data?.error, isNetwork: false };
}

/** 後端沒回訊息時，依 HTTP 狀態給說明。狀態碼本身不顯示給使用者。 */
function messageForStatus(status: number | undefined, fallback: string): string {
  switch (status) {
    case 400: return '輸入內容有誤，請檢查後重試';
    case 401: return '請先登入後再操作';
    case 403: return '權限不足，無法執行此操作';
    case 404: return '找不到指定的資料，可能已被刪除';
    case 409: return '目前狀態無法執行此操作，請重新整理後再試';
    case 413: return '檔案過大，請換小一點的檔案';
    case 429: return '操作太頻繁，請稍候再試';
    case 502:
    case 503:
    case 504: return '服務暫時無法使用，請稍後重試';
    default:
      if (status && status >= 500) return '系統發生錯誤，請稍後重試';
      return fallback;
  }
}

/**
 * 取得可顯示給使用者的錯誤訊息。
 *
 * @param fallback 前述來源都取不到時的說法。請寫成具體動作，
 *                 例如「儲存失敗，請稍後重試」而非「失敗」。
 */
export function getApiErrorMessage(err: unknown, fallback = '操作失敗，請稍後重試'): string {
  const { status, error, isNetwork } = extract(err);

  if (isNetwork) return '網路連線異常，請檢查網路後重試';

  // 後端已中文化，message 是首選
  if (error?.message) return error.message;

  // ⚠️ 刻意不回退到 error.code——那是 VALIDATION_ERROR 這類技術代碼，
  // 顯示給使用者沒有意義（這正是原本兩份重複 helper 的問題）
  return messageForStatus(status, fallback);
}

/**
 * 驗證錯誤的逐欄位說明。後端 ZodError 會在 details.issues 帶欄位層級訊息，
 * 表單可用它標在對應欄位旁，而不是只顯示一句籠統的「輸入有誤」。
 */
export function getFieldErrors(err: unknown): Record<string, string> {
  const { error } = extract(err);
  const issues = error?.details?.issues;
  if (!Array.isArray(issues)) return {};
  const out: Record<string, string> = {};
  for (const i of issues) {
    const item = i as { path?: string; message?: string };
    if (item.path && item.message) out[item.path] = item.message;
  }
  return out;
}

/** 取錯誤碼供程式判斷分支用（例如特定 code 要導頁）。不可直接顯示給使用者。 */
export function getApiErrorCode(err: unknown): string | undefined {
  return extract(err).error?.code;
}
