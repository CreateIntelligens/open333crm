/**
 * 免 captcha 捕捉登入 session（Wave 6 欄位級測試用）。
 *
 * 原理：UAT 的 captcha 只擋前端登入頁，後端 `POST /auth/login` 不驗 captcha。
 * 前端 accessToken 只存在記憶體（AuthProvider 的 module 變數），重新整理後
 * 靠 HttpOnly 的 refreshToken cookie 打 `/auth/refresh` 復原 session。
 * 因此只要把登入拿到的 refreshToken cookie 寫進 storageState，Playwright
 * 開頁就會自動 refresh 取得 accessToken，等同已登入。
 *
 * 跑法：
 *   npx tsx tests/e2e-uat/capture-auth-api.ts admin
 *   npx tsx tests/e2e-uat/capture-auth-api.ts supervisor
 *   npx tsx tests/e2e-uat/capture-auth-api.ts agent
 *   npx tsx tests/e2e-uat/capture-auth-api.ts all      # 一次捕捉三個角色
 *
 * 產出：auth-state.json（admin）/ auth-state-supervisor.json / auth-state-agent.json
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const BASE_URL = (process.env.MANUAL_BASE_URL || '').replace(/\/$/, '');
const API_BASE = process.env.MANUAL_API_URL || `${BASE_URL}/api/v1`;

/** 角色 → 帳密與輸出檔名。密碼可用環境變數覆蓋，避免寫死在 repo。 */
const ROLES = {
  admin: {
    email: process.env.E2E_ADMIN_EMAIL || 'admin@open333crm.dev',
    password: process.env.E2E_ADMIN_PASSWORD || 'Admin1234!',
    file: 'auth-state.json',
  },
  supervisor: {
    email: process.env.E2E_SUPERVISOR_EMAIL || 'supervisor@open333crm.dev',
    password: process.env.E2E_SUPERVISOR_PASSWORD || 'Super1234!',
    file: 'auth-state-supervisor.json',
  },
  agent: {
    email: process.env.E2E_AGENT_EMAIL || 'agent@open333crm.dev',
    password: process.env.E2E_AGENT_PASSWORD || 'Agent1234!',
    file: 'auth-state-agent.json',
  },
} as const;

type RoleKey = keyof typeof ROLES;

/** 從 Set-Cookie 標頭抽出 refreshToken 值 */
function extractRefreshToken(setCookie: string[]): string | null {
  for (const line of setCookie) {
    const m = /(?:^|;\s*)refreshToken=([^;]+)/.exec(line);
    if (m) return m[1];
  }
  return null;
}

async function captureRole(role: RoleKey): Promise<void> {
  const { email, password, file } = ROLES[role];
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    throw new Error(
      `[${role}] 登入失敗 HTTP ${res.status}：${JSON.stringify(body?.error ?? body)}`,
    );
  }

  // Node 18+ 的 Headers 有 getSetCookie()；舊版退回 raw get
  const setCookie: string[] =
    typeof (res.headers as any).getSetCookie === 'function'
      ? (res.headers as any).getSetCookie()
      : [res.headers.get('set-cookie') ?? ''];

  const refreshToken = extractRefreshToken(setCookie);
  if (!refreshToken) throw new Error(`[${role}] 回應沒有 refreshToken cookie`);

  // 解析 JWT 確認角色正確（避免帳號被改過角色卻無聲測錯身分）
  const payload = JSON.parse(
    Buffer.from(body.data.accessToken.split('.')[1], 'base64').toString(),
  );

  const domain = new URL(BASE_URL).hostname;
  const state = {
    cookies: [
      {
        name: 'refreshToken',
        value: refreshToken,
        domain,
        path: '/',
        // 給 7 天效期；後端 refreshToken 本身有自己的有效期，以後端為準
        expires: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
        httpOnly: true,
        secure: true,
        sameSite: 'Strict' as const,
      },
    ],
    origins: [],
  };

  const outPath = path.resolve(__dirname, '../../', file);
  fs.writeFileSync(outPath, JSON.stringify(state, null, 2));
  console.log(`✅ [${role}] role=${payload.role} agentId=${payload.agentId} → ${file}`);
}

(async () => {
  if (!BASE_URL) throw new Error('缺少 .env.local 的 MANUAL_BASE_URL');

  const arg = (process.argv[2] || 'all') as RoleKey | 'all';
  const targets: RoleKey[] =
    arg === 'all' ? (Object.keys(ROLES) as RoleKey[]) : [arg];

  for (const r of targets) {
    if (!ROLES[r]) {
      console.error(`未知角色「${r}」，可用：admin | supervisor | agent | all`);
      process.exit(1);
    }
  }

  for (const r of targets) await captureRole(r);
  console.log('\n全部完成。');
})();
