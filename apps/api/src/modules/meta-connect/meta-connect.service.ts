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
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { logger } from '@open333crm/core';
import { CHANNEL_TYPE } from '@open333crm/shared';
import { getConfig } from '../../config/env.js';
import type { TenantDb } from '../../lib/tenant-db.js';
import { AppError } from '../../shared/utils/response.js';
import type { BindingStore } from '../identity-binding/binding-code.js';
import {
  createChannel,
  decryptCredentials,
  encryptCredentials,
  patchChannelSettings,
  verifyChannel,
} from '../channel/channel.service.js';

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

/**
 * 綁定發起授權的瀏覽器：/start 在該瀏覽器設 HttpOnly cookie（值為 state 的雜湊），callback 比對。
 * 防止攻擊者把「自己產生的授權網址」丟給別的粉專管理員，對方同意後粉專被連進攻擊者的租戶。
 */
export const stateBinding = (state: string) => createHash('sha256').update(state).digest('hex');

function sameBinding(expected: string, actual: string | undefined): boolean {
  if (!actual) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 平台 App 若開啟「Require App Secret」，所有以使用者／粉專權杖呼叫的 Graph API 都要帶 appsecret_proof */
function appSecretProof(token: string, appSecret: string): string {
  return createHmac('sha256', appSecret).update(token).digest('hex');
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

/** 回傳授權網址與 state；呼叫端須以 stateBinding(state) 在發起者瀏覽器設 cookie */
export async function startConnect(store: MetaConnectStore, actor: StatePayload): Promise<{ url: string; state: string }> {
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
  return { url: `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`, state };
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
  /** 瀏覽器帶回的綁定 cookie（/start 時設定） */
  browserBinding: string | undefined,
): Promise<CallbackResult> {
  const cfg = requireMetaAppConfig();
  // state 一律先消耗（GETDEL）：就算使用者取消授權或瀏覽器不符，這個 state 也不能再被拿來用
  const raw = query.state ? await store.getdel(stateKey(query.state)) : null;
  if (!raw) return { ok: false, reason: 'invalid_state' };
  // 完成授權的必須是發起授權的同一個瀏覽器
  if (!sameBinding(stateBinding(query.state!), browserBinding)) return { ok: false, reason: 'invalid_state' };
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
    const userToken = String(long.access_token);
    const proof = appSecretProof(userToken, cfg.appSecret);
    // 跟著分頁取完（上限 5 頁 × 100 個粉專）
    const rawPages: Array<Record<string, any>> = [];
    let next: string | null = `${GRAPH}/me/accounts?fields=id,name,picture{url},access_token&limit=100&appsecret_proof=${proof}`;
    for (let i = 0; next && i < 5; i++) {
      const page: Record<string, any> = await graphGet(next, userToken);
      rawPages.push(...((page.data ?? []) as Array<Record<string, any>>));
      next = typeof page.paging?.next === 'string' && page.paging.next.startsWith(`${GRAPH}/`) ? page.paging.next : null;
    }
    pages = rawPages
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
  /** 本租戶原本就連著這個粉專：更新原渠道的權杖，對話紀錄與設定都保留 */
  | { pageId: string; status: 'reconnected'; channelId: string }
  | { pageId: string; status: 'failed'; code: string; message: string };

async function subscribePage(pageId: string, pageToken: string, appSecret: string): Promise<void> {
  const res = await fetch(`${GRAPH}/${pageId}/subscribed_apps`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pageToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      subscribed_fields: SUBSCRIBED_FIELDS.join(','),
      appsecret_proof: appSecretProof(pageToken, appSecret),
    }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok || body.error || !body.success) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
}

/**
 * 訂閱失敗時移除剛建立的渠道。建立到訂閱失敗之間若恰好有事件寫入（對話對渠道是 Restrict 外鍵），
 * 刪除會失敗：改為停用並清空帳號 ID，不讓整個請求出錯、也不留下仍佔著粉專的渠道。
 */
async function removeUnsubscribedChannel(db: TenantDb, channelId: string, tenantId: string) {
  try {
    await db.channel.deleteMany({ where: { id: channelId, tenantId } });
  } catch (err) {
    logger.warn('[MetaConnect] 刪除未完成的渠道失敗，改為停用', { channelId, error: err instanceof Error ? err.message : String(err) });
    await db.channel.updateMany({ where: { id: channelId, tenantId }, data: { isActive: false, externalAccountId: null } });
  }
}

/** 平台模式渠道刪除時取消粉專對平台 App 的訂閱（盡力而為，失敗只記 log，不擋刪除） */
export async function unsubscribePlatformPage(credentials: Record<string, unknown>): Promise<void> {
  const cfg = getMetaAppConfig();
  const pageId = credentials.pageId as string | undefined;
  const token = credentials.pageAccessToken as string | undefined;
  if (!cfg || credentials.connectMode !== 'platform' || !pageId || !token) return;
  try {
    const res = await fetch(
      `${GRAPH}/${pageId}/subscribed_apps?appsecret_proof=${appSecretProof(token, cfg.appSecret)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) logger.warn('[MetaConnect] 取消粉專訂閱失敗', { pageId, status: res.status });
  } catch (err) {
    logger.warn('[MetaConnect] 取消粉專訂閱失敗', { pageId, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function connectPages(
  db: TenantDb,
  store: MetaConnectStore,
  connectId: string,
  actor: StatePayload,
  pageIds: string[],
): Promise<ConnectPageResult[]> {
  const cfg = requireMetaAppConfig();
  const session = await loadSession(store, connectId, actor);
  const results: ConnectPageResult[] = [];

  for (const pageId of pageIds) {
    const page = session.pages.find((p) => p.id === pageId);
    if (!page) {
      results.push({ pageId, status: 'failed', code: 'PAGE_NOT_AUTHORIZED', message: '此粉專不在這次授權的清單中' });
      continue;
    }

    // 0. 重新連結：本租戶已有啟用中的渠道連著這個粉專（權杖失效、管理員換人、移除過應用程式等）→
    //    更新原渠道的權杖，不另建渠道，對話紀錄、設定、分店權限都保留。
    //    先用新權杖訂閱成功才寫入；失敗時原渠道完全不動（不可像新建流程那樣刪除）
    const existing = await db.channel.findFirst({
      where: { tenantId: actor.tenantId, channelType: CHANNEL_TYPE.FB, externalAccountId: page.id, isActive: true },
      select: { id: true, credentialsEncrypted: true },
    });
    if (existing) {
      try {
        await subscribePage(page.id, page.accessToken, cfg.appSecret);
      } catch (err) {
        logger.warn('[MetaConnect] 重新連結時粉專訂閱失敗，原渠道不變', {
          tenantId: actor.tenantId,
          pageId,
          error: err instanceof Error ? err.message : String(err),
        });
        results.push({ pageId, status: 'failed', code: 'SUBSCRIBE_FAILED', message: '無法訂閱此粉專的訊息，請確認您是粉專管理員並已授予訊息權限' });
        continue;
      }
      let oldCreds: Record<string, unknown> = {};
      try {
        oldCreds = decryptCredentials(existing.credentialsEncrypted);
      } catch {
        /* 舊憑證解不開（例如跨環境金鑰不同）就直接用新的 */
      }
      // 改為平台模式：新權杖來自平台 App 的授權；自備 App 的 appSecret 在平台模式下不採用（見 signedBySameApp）
      const credentials = { ...oldCreds, connectMode: 'platform', pageAccessToken: page.accessToken, pageId: page.id };
      await db.channel.updateMany({
        where: { id: existing.id, tenantId: actor.tenantId },
        data: { credentialsEncrypted: encryptCredentials(credentials), webhookUrl: null },
      });
      await patchChannelSettings(
        db,
        existing.id,
        actor.tenantId,
        { metaConnect: { mode: 'platform', connectedAt: new Date().toISOString(), connectedBy: actor.agentId, reconnected: true } },
        ['tokenHealth', 'tokenExpiresAt'],
      );
      await verifyChannel(db, existing.id, actor.tenantId).catch((err: unknown) =>
        logger.warn('[MetaConnect] 重新連結後驗證失敗（不影響收發）', { channelId: existing.id, error: err instanceof Error ? err.message : String(err) }),
      );
      results.push({ pageId, status: 'reconnected', channelId: existing.id });
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
      await subscribePage(page.id, page.accessToken, cfg.appSecret);
    } catch (err) {
      await removeUnsubscribedChannel(db, channelId, actor.tenantId);
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
  if (results.every((r) => r.status !== 'failed')) await store.getdel(sessionKey(connectId));
  return results;
}
