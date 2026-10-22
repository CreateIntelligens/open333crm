/**
 * LIFF 入口頁（/liff/redirect）的票券流程（add-coupon-system design D20）：
 * LINE 登入 → 取得 ID token → 後端向 LINE 驗證並記錄歸戶 → 記住這台裝置（design D24）→ 開啟一般票券網址。
 * 任何一步失敗都改開一般票券網址，由那一頁走 One ID 登記；只有「帳號不符」直接告知顧客。
 */

/** 用到的 LIFF SDK 子集 */
export interface LiffForCoupon {
  isLoggedIn(): boolean;
  login(config?: { redirectUri?: string }): void;
  getIDToken(): string | null;
}

export interface LiffCouponDeps {
  initLiff: (liffId: string) => Promise<LiffForCoupon>;
  post: (url: string, body: unknown) => Promise<{ data: { data: { status: string; deviceToken?: string } } }>;
  /** 存下裝置憑證（lib/fan-device）：一般票券網址呼叫 /session 時帶上，已歸戶的顧客不必再驗證 */
  rememberDeviceToken: (token: string) => void;
  /** 登入後回到的網址（目前這一頁） */
  currentUrl: string;
}

export type LiffCouponOutcome =
  | { kind: 'navigate'; to: string }
  | { kind: 'login' }
  | { kind: 'message'; text: string };

/** 與後端票券權杖相同的格式；不符就不送請求，避免被組成其他路徑 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;

export const ACCOUNT_MISMATCH_TEXT = '這張優惠券是發給其他 LINE 帳號的，請用收到優惠券的 LINE 帳號開啟。';

export async function openCouponViaLiff(token: string, liffId: string, deps: LiffCouponDeps): Promise<LiffCouponOutcome> {
  if (!TOKEN_PATTERN.test(token)) return { kind: 'message', text: '連結無效' };
  const fallback: LiffCouponOutcome = { kind: 'navigate', to: `/coupon/open/${token}` };
  try {
    const liff = await deps.initLiff(liffId);
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: deps.currentUrl });
      return { kind: 'login' };
    }
    const idToken = liff.getIDToken();
    if (!idToken) return fallback;
    const res = await deps.post('/fan/coupons/liff-session', { token, idToken });
    const { status, deviceToken } = res.data.data;
    if (status === 'account_mismatch') return { kind: 'message', text: ACCOUNT_MISMATCH_TEXT };
    if (status === 'verified' && deviceToken) deps.rememberDeviceToken(deviceToken);
    return fallback;
  } catch {
    return fallback;
  }
}
