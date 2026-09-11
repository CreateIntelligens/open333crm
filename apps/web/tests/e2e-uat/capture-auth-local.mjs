/**
 * 本機直登產 auth-state.json（跳過前端 captcha）。
 *
 * UAT 版 capture-auth.ts 需人工過 captcha；本機 API login 無 captcha 驗證，
 * 直接以 context.request 打 POST /auth/login，HttpOnly refreshToken cookie
 * 會進 context cookie jar（localhost 不分 port，3000 前端可用），storageState 存檔。
 *
 * 用法：node tests/e2e-uat/capture-auth-local.mjs [email] [password]
 *   預設 admin@open333crm.dev / Admin1234!，輸出 auth-state.json。
 *   第三參數可指定輸出檔（如 auth-state-agent.json）。
 */
import { chromium } from '@playwright/test';

const email = process.argv[2] || 'admin@open333crm.dev';
const password = process.argv[3] || 'Admin1234!';
const out = process.argv[4] || 'auth-state.json';
const API = process.env.LOCAL_API_URL || 'http://localhost:3001';

const browser = await chromium.launch();
const context = await browser.newContext();
const res = await context.request.post(`${API}/api/v1/auth/login`, {
  data: { email, password, rememberMe: true },
});
if (!res.ok()) {
  console.error(`登入失敗 ${res.status()}: ${await res.text()}`);
  process.exit(1);
}
await context.storageState({ path: out });
console.log(`✅ ${email} 登入成功，auth 狀態已存 ${out}`);
await browser.close();
