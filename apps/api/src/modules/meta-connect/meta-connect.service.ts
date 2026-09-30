/**
 * 平台持有的 Meta App：租戶以 Facebook 登入連結粉專（change fix-meta-webhook-page-routing 第 3 階段，design D8）。
 *
 * 流程：
 *   1. start：產生一次性 state（Redis，10 分鐘，綁租戶＋操作者）→ 回傳 Facebook 登入網址
 *   2. callback：驗 state（GETDEL，只能用一次）→ code 換 user token → 換長效 token →
 *      /me/accounts 取粉專清單與 Page token → 整包加密暫存 Redis（connect session）→ 轉址回前端
 *   3. pages：只回粉專 ID、名稱、頭像、本租戶是否已連結——**token 永遠不回傳前端**
 *   4. connect：逐一建立平台模式渠道（先寫帳號 ID，唯一索引擋重複）→ 訂閱粉專到平台 App →
 *      訂閱失敗就刪除剛建立的渠道，不留半套
 *
 * callback 沒有登入 session，但整段只碰 Redis 與 Graph API、不查資料庫，不需要 prismaAdmin。
 */
import { randomBytes } from 'node:crypto';
import { logger } from '@open333crm/core';
import { CHANNEL_TYPE } from '@open333crm/shared';
import { getConfig } from '../../config/env.js';
import type { TenantDb } from '../../lib/tenant-db.js';
import { AppError } from '../../shared/utils/response.js';
import type { BindingStore } from '../identity-binding/binding-code.js';
import { createChannel, decryptCredentials, encryptCredentials, verifyChannel } from '../channel/channel.service.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const SESSION_TTL_MS = 10 * 60 * 1000;
/** 訂閱粉專時要接收的事件（referral 供跨渠道綁定、echo 供辨識自己送出的訊息） */
export const SUBSCRIBED_FIELDS = ['messages', 'messaging_postbacks', 'messaging_referrals', 'message_echoes'];
/** 傳統授權（未設定 Facebook Login for Business 設定 ID 時）要求的權限 */
const LEGACY_SCOPES = ['pages_show_list', 'pages_manage_metadata', 'pages_messaging', 'pages_read_engagement'];

export type MetaConnectStore = Pick<BindingStore, 'set' | 'get' | 'getdel'>;

export interface MetaAppConfig {
  appId: string;
  appSecret: string;
  verifyToken: string;
  redirectUri: string;
  loginConfigId?: string;
}

/** 平台 Meta App 設定；任一必要值缺少就視為未啟用 */
export function getMetaAppConfig(): MetaAppConfig | null {
  const c = getConfig();
  if (!c.META_APP_ID || !c.META_APP_SECRET || !c.META_WEBHOOK_VERIFY_TOKEN || !c.META_CONNECT_REDIRECT_URI) return null;
  return {
    appId: c.META_APP_ID,
    appSecret: c.META_APP_SECRET,
    verifyToken: c.META_WEBHOOK_VERIFY_TOKEN,
    redirectUri: c.META_CONNECT_REDIRECT_URI,
    loginConfigId: c.META_LOGIN_CONFIG_ID || undefined,
  };
}

export function requireMetaAppConfig(): MetaAppConfig {
  const cfg = getMetaAppConfig();
  if (!cfg) throw new AppError('平台尚未設定 Facebook 應用程式，暫時無法使用 Facebook 登入連結粉專', 'META_CONNECT_NOT_CONFIGURED', 503);
  return cfg;
}

const stateKey = (state: string) => `metaconnect:state:${state}`;
const sessionKey = (connectId: string) => `metaconnect:session:${connectId}`;
const token = () => randomBytes(24).toString('base64url');

interface StatePayload {
  tenantId: string;
  agentId: string;
}

interface SessionPage {
  id: string;
  name: string;
  pictureUrl: string | null;
  accessToken: string;
}

interface SessionPayload extends StatePayload {
  pages: SessionPage[];
}

// ── 1. start ────────────────────────────────────────────────────────────────

export async function startConnect(store: MetaConnectStore, actor: StatePayload): Promise<{ url: string }> {
  const cfg = requireMetaAppConfig();
  const state = token();
  await store.set(stateKey(state), JSON.stringify(actor), 'PX', SESSION_TTL_MS, 'NX');
  const params = new URLSearchParams({
    client_id: cfg.appId,
    redirect_uri: cfg.redirectUri,
    state,
    response_type: 'code',
  });
  if (cfg.loginConfigId) {
    params.set('config_id', cfg.loginConfigId);
    params.set('override_default_response_type', 'true');
  } else {
    params.set('scope', LEGACY_SCOPES.join(','));
  }
  return { url: `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}` };
}

// ── 2. callback ─────────────────────────────────────────────────────────────

async function graphGet(url: string, bearer?: string): Promise<Record<string, any>> {
  const res = await fetch(url, bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : undefined);
  const body = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok || body.error) {
    // 不把 URL（含 client_secret／code）寫進錯誤或 log
    throw new Error(body.error?.message ?? `Graph API HTTP ${res.status}`);
  }
  return body;
}

export type CallbackResult = { ok: true; connectId: string } | { ok: false; reason: 'denied' | 'invalid_state' | 'exchange_failed' | 'no_pages' };

/**
 * OAuth 回呼。回傳結果由路由轉成前端網址；任何失敗都不留下 token。
 */
export async function handleCallback(
  store: MetaConnectStore,
  query: { code?: string; state?: string; error?: string },
): Promise<CallbackResult> {
  const cfg = requireMetaAppConfig();
  // state 一律先消耗（GETDEL）：就算使用者取消授權，這個 state 也不能再被拿來用
  const raw = query.state ? await store.getdel(stateKey(query.state)) : null;
  if (!raw) return { ok: false, reason: 'invalid_state' };
  if (query.error || !query.code) return { ok: false, reason: 'denied' };
  const actor = JSON.parse(raw) as StatePayload;

  let pages: SessionPage[];
  try {
    const short = await graphGet(
      `${GRAPH}/oauth/access_token?${new URLSearchParams({
        client_id: cfg.appId,
        client_secret: cfg.appSecret,
        redirect_uri: cfg.redirectUri,
        code: query.code,
      })}`,
    );
    // 換長效 user token：由它取得的 Page token 不會過期
    const long = await graphGet(
      `${GRAPH}/oauth/access_token?${new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: cfg.appId,
        client_secret: cfg.appSecret,
        fb_exchange_token: String(short.access_token),
      })}`,
    );
    const accounts = await graphGet(`${GRAPH}/me/accounts?fields=id,name,picture{url},access_token&limit=100`, String(long.access_token));
    pages = ((accounts.data ?? []) as Array<Record<string, any>>)
      .filter((p) => p.id && p.access_token)
      .map((p) => ({
        id: String(p.id),
        name: String(p.name ?? p.id),
        pictureUrl: p.picture?.data?.url ?? null,
        accessToken: String(p.access_token),
      }));
  } catch (err) {
    logger.warn('[MetaConnect] 授權交換失敗', { tenantId: actor.tenantId, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, reason: 'exchange_failed' };
  }
  if (pages.length === 0) return { ok: false, reason: 'no_pages' };

  const connectId = token();
  const payload: SessionPayload = { ...actor, pages };
  await store.set(sessionKey(connectId), encryptCredentials(payload as unknown as Record<string, unknown>), 'PX', SESSION_TTL_MS, 'NX');
  return { ok: true, connectId };
}

// ── 3. pages ────────────────────────────────────────────────────────────────

async function loadSession(store: MetaConnectStore, connectId: string, actor: StatePayload): Promise<SessionPayload> {
  const raw = await store.get(sessionKey(connectId));
  const session = raw ? (decryptCredentials(raw) as unknown as SessionPayload) : null;
  // 只有發起授權的同一個人、同一個租戶能讀取；其他人一律當作不存在
  if (!session || session.tenantId !== actor.tenantId || session.agentId !== actor.agentId) {
    throw new AppError('授權已過期或無效，請重新點「用 Facebook 連結粉專」', 'META_CONNECT_SESSION_INVALID', 404);
  }
  return session;
}

export interface ConnectablePage {
  id: string;
  name: string;
  pictureUrl: string | null;
  /** 本租戶已有渠道連結此粉專 */
  linkedInThisTenant: boolean;
}

export async function listConnectablePages(
  db: TenantDb,
  store: MetaConnectStore,
  connectId: string,
  actor: StatePayload,
): Promise<ConnectablePage[]> {
  const session = await loadSession(store, connectId, actor);
  const linked = await db.channel.findMany({
    where: { tenantId: actor.tenantId, channelType: CHANNEL_TYPE.FB, externalAccountId: { in: session.pages.map((p) => p.id) } },
    select: { externalAccountId: true },
  });
  const linkedIds = new Set(linked.map((c) => c.externalAccountId));
  // 刻意不回傳 accessToken
  return session.pages.map((p) => ({ id: p.id, name: p.name, pictureUrl: p.pictureUrl, linkedInThisTenant: linkedIds.has(p.id) }));
}

// ── 4. connect ──────────────────────────────────────────────────────────────

export type ConnectPageResult =
  | { pageId: string; status: 'connected'; channelId: string }
  | { pageId: string; status: 'failed'; code: string; message: string };

async function subscribePage(pageId: string, pageToken: string): Promise<void> {
  const res = await fetch(`${GRAPH}/${pageId}/subscribed_apps`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pageToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ subscribed_fields: SUBSCRIBED_FIELDS.join(',') }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok || body.error || !body.success) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
}

export async function connectPages(
  db: TenantDb,
  store: MetaConnectStore,
  connectId: string,
  actor: StatePayload,
  pageIds: string[],
): Promise<ConnectPageResult[]> {
  const session = await loadSession(store, connectId, actor);
  const results: ConnectPageResult[] = [];

  for (const pageId of pageIds) {
    const page = session.pages.find((p) => p.id === pageId);
    if (!page) {
      results.push({ pageId, status: 'failed', code: 'PAGE_NOT_AUTHORIZED', message: '此粉專不在這次授權的清單中' });
      continue;
    }

    // 1. 先建立渠道並寫入帳號 ID：唯一索引先擋掉重複連結，不會對別人正在用的粉專做任何 Meta 呼叫
    let channelId: string;
    try {
      const channel = await createChannel(db, actor.tenantId, {
        channelType: CHANNEL_TYPE.FB,
        displayName: page.name,
        credentials: { connectMode: 'platform', pageAccessToken: page.accessToken, pageId: page.id },
        settings: { metaConnect: { mode: 'platform', connectedAt: new Date().toISOString(), connectedBy: actor.agentId } },
        externalAccountId: page.id,
      });
      channelId = channel.id;
    } catch (err) {
      const e = err as AppError;
      results.push({ pageId, status: 'failed', code: e.code ?? 'CREATE_FAILED', message: e.message ?? '建立渠道失敗' });
      continue;
    }

    // 2. 訂閱粉專到平台 App；失敗就刪掉剛建立的渠道（尚無任何訊息，直接刪除），不留半套
    try {
      await subscribePage(page.id, page.accessToken);
    } catch (err) {
      await db.channel.deleteMany({ where: { id: channelId, tenantId: actor.tenantId } });
      logger.warn('[MetaConnect] 粉專訂閱失敗，已移除渠道', {
        tenantId: actor.tenantId,
        pageId,
        error: err instanceof Error ? err.message : String(err),
      });
      results.push({ pageId, status: 'failed', code: 'SUBSCRIBE_FAILED', message: '無法訂閱此粉專的訊息，請確認您是粉專管理員並已授予訊息權限' });
      continue;
    }

    // 3. 平台模式渠道收事件走 /webhooks/meta，不需要渠道自己的回呼網址
    await db.channel.updateMany({ where: { id: channelId, tenantId: actor.tenantId }, data: { webhookUrl: null } });
    // 4. 補做一次驗證：寫入導流識別、「開始使用」按鈕檢查等；失敗不影響連結（渠道已可收發）
    await verifyChannel(db, channelId, actor.tenantId).catch((err: unknown) =>
      logger.warn('[MetaConnect] 連結後驗證失敗（不影響收發）', { channelId, error: err instanceof Error ? err.message : String(err) }),
    );
    results.push({ pageId, status: 'connected', channelId });
  }

  // 全部處理完才作廢 session；有失敗的可以在同一個授權內重試
  if (results.every((r) => r.status === 'connected')) await store.getdel(sessionKey(connectId));
  return results;
}
