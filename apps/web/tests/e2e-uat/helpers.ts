import { Browser, BrowserContext, Page, expect } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

export const BASE_URL = (process.env.MANUAL_BASE_URL || '').replace(/\/$/, '');

/** console 噪音白名單：第三方/favicon/預期中的 4xx 不算失敗 */
const CONSOLE_IGNORE = [
  /favicon/i,
  /third-party cookie/i,
  /net::ERR_BLOCKED_BY_CLIENT/i,
  /Download the React DevTools/i,
  // 第三方頭像 CDN（LINE/FB/IG）連結會過期，403/404 屬正常噪音非功能 bug
  /line-scdn\.net/i,
  /fbcdn\.net/i,
  /cdninstagram\.com/i,
  // 第三方客服小工具 SDK，網路波動下偶發載入失敗，與被測功能無關（Wave 4 整合跑首次遇到）
  /Failed to initialize WebTalk|Failed to load WebTalk SDK/i,
];

/**
 * 開頁 + 基本驗收：非登入頁、收集 console error。
 * 回傳收集到的 console error（過濾噪音後），呼叫端自行斷言。
 */
export async function gotoAndCheck(page: Page, urlPath: string): Promise<string[]> {
  if (!BASE_URL) throw new Error('缺少 .env.local 的 MANUAL_BASE_URL');
  const errors: string[] = [];
  page.on('console', (msg) => {
    // 帶上來源 URL，「Failed to load resource」類錯誤才可判讀
    const loc = msg.location()?.url ? ` [${msg.location().url}]` : '';
    const text = `${msg.text()}${loc}`;
    if (msg.type() === 'error' && !CONSOLE_IGNORE.some((re) => re.test(text))) {
      errors.push(text);
    }
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

  await page.goto(`${BASE_URL}${urlPath}`, { waitUntil: 'networkidle' });

  // session 掉了會被導回登入頁——這是環境問題不是功能 bug，用明確訊息 fail
  const url = page.url();
  if (/\/(login|admin\/login)(\?|$)/.test(url)) {
    throw new Error(
      `導頁後落在登入頁（${url}）——session 已失效，請重跑 capture-auth 後重試（非功能 bug）`,
    );
  }
  return errors;
}

/** 斷言頁面主要內容已渲染（給一個該頁必然出現的文字或 role 定位） */
export async function expectVisibleText(page: Page, text: string) {
  await expect(page.getByText(text, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Wave 1 功能層測試共用基建
// ---------------------------------------------------------------------------

import { APIRequestContext, request as pwRequest } from '@playwright/test';
import { randomUUID } from 'crypto';
import * as fs from 'fs';

/** 測試資料命名前綴：所有測試自建資料一律帶此前綴，方便辨識與清理 */
export const E2E_PREFIX = '[E2E]';

// API base：UAT 走 Caddy 同網域轉發（BASE_URL/api/v1）；本機 Next 無 /api 代理，
// 用 MANUAL_API_URL 指到 api 服務（如 http://localhost:3001/api/v1）覆蓋。
export const API_BASE = process.env.MANUAL_API_URL || `${BASE_URL}/api/v1`;

/** UAT 租戶的 WEBCHAT 渠道（種測試對話用；公開端點不需 auth） */
export const WEBCHAT_CHANNEL_ID = '4f61ec56-bed5-488d-b7d5-1f2a2b279963';

/** 攔下一個原生 confirm/alert 並接受（破壞性操作用）。回傳 promise 供斷言 dialog 訊息。 */
export function acceptNextDialog(page: Page): Promise<string> {
  return new Promise((resolve) => {
    page.once('dialog', async (dialog) => {
      const msg = dialog.message();
      await dialog.accept();
      resolve(msg);
    });
  });
}

/** 攔下一個原生 confirm 並取消（驗「取消分支」用） */
export function dismissNextDialog(page: Page): Promise<string> {
  return new Promise((resolve) => {
    page.once('dialog', async (dialog) => {
      const msg = dialog.message();
      await dialog.dismiss();
      resolve(msg);
    });
  });
}

/** 斷言浮動 toast 出現（成功/失敗訊息） */
export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 10_000 });
}

/**
 * 用 auth-state.json 的 refreshToken 換 access token（種資料/清理走 API 用）。
 * refresh 為無狀態 JWT，不會使既有瀏覽器 session 失效。
 */
export async function getApiToken(): Promise<string> {
  const state = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../auth-state.json'), 'utf8'),
  );
  const cookie = (state.cookies || []).find((c: { name: string }) => c.name === 'refreshToken');
  if (!cookie) throw new Error('auth-state.json 內找不到 refreshToken，請重跑 capture-auth');
  const ctx = await pwRequest.newContext({ ignoreHTTPSErrors: true });
  const res = await ctx.post(`${API_BASE}/auth/refresh`, {
    headers: { Cookie: `refreshToken=${cookie.value}` },
    data: {},
  });
  if (!res.ok()) throw new Error(`auth/refresh 失敗（${res.status()}）——session 已失效，請重跑 capture-auth`);
  const body = await res.json();
  const token = body?.data?.accessToken;
  await ctx.dispose();
  if (!token) throw new Error('auth/refresh 回應中沒有 accessToken');
  return token;
}

/**
 * 建一個帶 Bearer token 的 API context（呼叫端負責 dispose）。
 * ⚠️ baseURL 尾帶 `/`：呼叫時路徑「不可」以 `/` 開頭（如 `api.get('conversations')`），
 * 否則 URL resolution 會把 `/api/v1` 蓋掉打到根路徑去。
 */
export async function newApiContext(): Promise<APIRequestContext> {
  const token = await getApiToken();
  return pwRequest.newContext({
    baseURL: `${API_BASE}/`,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}

/** 固定 fingerprint：verify/messages 會比對 fingerprint hash，所有呼叫必須一致 */
const CHATBOX_FINGERPRINT = {
  browserFamily: 'Chrome',
  osFamily: 'macOS',
  language: 'zh-TW',
  timezone: 'Asia/Taipei',
  screenBucket: '1440x900',
};

let cachedPublicKey: string | null = null;

/** 取 WEBCHAT 渠道的 chatbox publicKey（authed，一次快取） */
export async function getChatboxPublicKey(api: APIRequestContext): Promise<string> {
  if (cachedPublicKey) return cachedPublicKey;
  const res = await api.post(`channels/${WEBCHAT_CHANNEL_ID}/chatbox-link`, {
    data: { domain: BASE_URL },
  });
  if (!res.ok()) throw new Error(`chatbox-link 取得失敗（${res.status()}）`);
  const body = await res.json();
  cachedPublicKey = body?.data?.publicKey;
  if (!cachedPublicKey) throw new Error('chatbox-link 回應中沒有 publicKey');
  return cachedPublicKey;
}

export interface SeededConversation {
  /** 訪客 session（後續補發訊息用） */
  sessionId: string;
  claimToken: string;
  marker: string;
  conversationId: string;
  contactId: string;
  /** 訪客聯絡人顯示名（Chatbox Visitor xxxxxx） */
  contactName: string;
}

/**
 * 種一條 WEBCHAT 測試對話（secure Chatbox flow）：
 * sessions（建 contact+conversation）→ sessions/verify（拿 claimToken）→ messages（發 marker 訊息），
 * 再用 authed API 反查 conversationId / contactId。
 * 注意 rate limit：sessions 10 次/分/IP —— 測試 seed 請節制。
 */
export async function seedWebchatConversation(
  api: APIRequestContext,
  label = '測試訊息',
): Promise<SeededConversation> {
  const publicKey = await getChatboxPublicKey(api);
  const marker = `${E2E_PREFIX} ${label} ${randomUUID().slice(0, 8)}`;
  const pub = await pwRequest.newContext({ ignoreHTTPSErrors: true });
  try {
    const sess = await pub.post(`${API_BASE}/chatbox/sessions`, {
      data: { channel: publicKey, fingerprint: CHATBOX_FINGERPRINT },
    });
    if (!sess.ok()) throw new Error(`chatbox session 建立失敗（${sess.status()}）${await sess.text()}`);
    const sessionId: string = (await sess.json())?.data?.sessionId;

    const verify = await pub.post(`${API_BASE}/chatbox/sessions/verify`, {
      data: { sessionId, fingerprint: CHATBOX_FINGERPRINT },
    });
    if (!verify.ok()) throw new Error(`chatbox verify 失敗（${verify.status()}）${await verify.text()}`);
    const claimToken: string = (await verify.json())?.data?.claimToken;

    await chatboxSend(pub, sessionId, claimToken, marker);

    // 反查對話：訊息落庫是非同步管線，輪詢最多 20 秒
    for (let i = 0; i < 20; i++) {
      const res = await api.get('conversations', { params: { limit: '50' } });
      if (res.ok()) {
        const body = await res.json();
        const data = body?.data ?? {};
        const items: Array<Record<string, unknown>> =
          data.items ?? data.conversations ?? (Array.isArray(data) ? data : []);
        const hit = items.find((c) => JSON.stringify(c).includes(marker));
        if (hit) {
          const contact = hit.contact as Record<string, unknown> | undefined;
          return {
            sessionId,
            claimToken,
            marker,
            conversationId: String(hit.id),
            contactId: String(contact?.id ?? hit.contactId ?? ''),
            contactName: String(contact?.displayName ?? contact?.name ?? ''),
          };
        }
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`種完 chatbox 對話後 20 秒內查不到（marker=${marker}）`);
  } finally {
    await pub.dispose();
  }
}

/** 訪客端再補發一則訊息（模擬客戶回話） */
export async function sendVisitorMessage(seeded: SeededConversation, text: string): Promise<void> {
  const pub = await pwRequest.newContext({ ignoreHTTPSErrors: true });
  try {
    await chatboxSend(pub, seeded.sessionId, seeded.claimToken, text);
  } finally {
    await pub.dispose();
  }
}

async function chatboxSend(
  pub: APIRequestContext,
  sessionId: string,
  claimToken: string,
  text: string,
): Promise<void> {
  const res = await pub.post(`${API_BASE}/chatbox/messages`, {
    data: {
      sessionId,
      claimToken,
      clientMessageId: randomUUID(),
      type: 'text',
      payload: { text },
      fingerprint: CHATBOX_FINGERPRINT,
    },
  });
  if (!res.ok()) throw new Error(`chatbox 訊息發送失敗（${res.status()}）${await res.text()}`);
}

/** 跨平台測試用：開租戶身分 context（storageState=auth-state.json） */
export async function openTenantContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    storageState: path.resolve(__dirname, '../../auth-state.json'),
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
}

/** 跨平台測試用：開平台管理員身分 context（storageState=auth-state-platform.json） */
export async function openPlatformContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    storageState: path.resolve(__dirname, '../../auth-state-platform.json'),
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
}
