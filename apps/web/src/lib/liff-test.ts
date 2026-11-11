/**
 * LIFF 入口頁（/liff/redirect）的設定測試流程（change add-liff-config-test）：
 * 跟顧客開券走同一條路 —— 啟動 LIFF → 登入 → 取得 ID token → 送到後端驗證，再把結果說明顯示在手機上。
 * LIFF 啟動失敗或沒有 ID token 時，也回報給後端，讓後台看得到原因（design D5）。
 */

/** 用到的 LIFF SDK 子集 */
export interface LiffForTest {
  isLoggedIn(): boolean;
  login(config?: { redirectUri?: string }): void;
  getIDToken(): string | null;
}

export interface LiffTestPageDeps {
  initLiff: (liffId: string) => Promise<LiffForTest>;
  post: (url: string, body: unknown) => Promise<{ data: { data: { status: string; message: string } } }>;
  /** 登入後回到的網址（目前這一頁） */
  currentUrl: string;
}

export type LiffTestPageOutcome = { kind: 'login' } | { kind: 'message'; text: string; ok: boolean };

export const LIFF_TEST_EXPIRED_TEXT = '測試連結已過期，請回後台重新產生。';
const SEND_FAILED_TEXT = '沒有送出測試結果，請確認網路後重新開啟測試連結。';

async function report(testId: string, body: { idToken: string } | { failure: 'init_failed' | 'no_id_token' }, deps: LiffTestPageDeps): Promise<LiffTestPageOutcome> {
  try {
    const res = await deps.post('/fan/liff-test', { testId, ...body });
    const { status, message } = res.data.data;
    return { kind: 'message', text: message, ok: status === 'verified' };
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    return { kind: 'message', text: status === 410 ? LIFF_TEST_EXPIRED_TEXT : SEND_FAILED_TEXT, ok: false };
  }
}

export async function runLiffTest(testId: string, liffId: string, deps: LiffTestPageDeps): Promise<LiffTestPageOutcome> {
  let liff: LiffForTest;
  try {
    liff = await deps.initLiff(liffId);
  } catch {
    return report(testId, { failure: 'init_failed' }, deps);
  }
  let idToken: string | null;
  try {
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: deps.currentUrl });
      return { kind: 'login' };
    }
    idToken = liff.getIDToken();
  } catch {
    // 啟動後的 SDK 呼叫拋錯也要回報，否則後台會一直等到連結過期
    return report(testId, { failure: 'init_failed' }, deps);
  }
  return report(testId, idToken ? { idToken } : { failure: 'no_id_token' }, deps);
}
