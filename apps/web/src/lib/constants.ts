import { getPublicRuntimeEndpoints } from '@open333crm/shared';

const publicRuntimeEndpoints = getPublicRuntimeEndpoints(process.env.NEXT_PUBLIC_API_URL);

export const API_BASE_URL = publicRuntimeEndpoints.apiBaseUrl;
export const REALTIME_ORIGIN = publicRuntimeEndpoints.realtimeOrigin;

// 登入頁 playcaptcha 夾娃娃機小遊戲關卡開關。預設啟用；
// 設為字串 'false' 時停用（供 demo／本地開發／E2E 繞過，因 E2E 亦以 Playwright 驅動）。
export const LOGIN_CAPTCHA_ENABLED =
  process.env.NEXT_PUBLIC_LOGIN_CAPTCHA_ENABLED !== 'false';
