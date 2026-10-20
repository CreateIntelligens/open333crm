/**
 * 票券連結（add-coupon-system design D12）：發券訊息帶一組隨機權杖，顧客開啟時用它換顧客憑證。
 *
 * API（對話發券）與 workers（自動化發券）都要發這個連結，所以放在 core，兩端共用同一套權杖與文案。
 * 權杖存 Redis，綁定租戶、聯絡人與該張券；7 天內可重複開啟（顧客常隔幾天才點），不是一次性。
 */
import { randomBytes } from 'node:crypto';

/** 票券連結的有效期 */
export const WALLET_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const KEY_PREFIX = 'coupon:wallet:';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;

/** 只需要 Redis 的 set／get；ioredis 與測試用的記憶體儲存都符合 */
export interface WalletTokenStore {
  set(key: string, value: string, mode: 'PX', ttlMs: number, condition: 'NX'): Promise<'OK' | null>;
  get(key: string): Promise<string | null>;
}

export interface WalletTokenPayload {
  tenantId: string;
  /** 發券當下的聯絡人；之後若被合併，開啟時依合併鏈找到保留方 */
  contactId: string;
  /** 收到訊息的渠道身分與對話：未歸戶時用來產生 One ID 登記連結 */
  channelIdentityId: string;
  channelId: string;
  conversationId: string;
  instanceId: string;
}

export type WalletToken = WalletTokenPayload & { issuedAt: number };

export async function issueWalletToken(
  store: WalletTokenStore,
  payload: WalletTokenPayload,
  now: () => number = Date.now,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const value: WalletToken = { ...payload, issuedAt: now() };
  await store.set(`${KEY_PREFIX}${token}`, JSON.stringify(value), 'PX', WALLET_LINK_TTL_MS, 'NX');
  return token;
}

/** 讀取票券連結（不消耗）。不存在、過期或格式不符回 null。 */
export async function readWalletToken(store: WalletTokenStore, token: string): Promise<WalletToken | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const raw = await store.get(`${KEY_PREFIX}${token}`);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as WalletToken;
    return typeof p.tenantId === 'string' && typeof p.contactId === 'string' && typeof p.instanceId === 'string'
      ? p
      : null;
  } catch {
    return null;
  }
}

export function walletLinkUrl(webBaseUrl: string, token: string): string {
  return `${webBaseUrl.replace(/\/+$/, '')}/coupon/open/${token}`;
}

/**
 * 發券訊息。純文字加連結——各渠道都支援，不依賴特定版型能力。
 * 條款只在票券頁呈現，訊息不帶（spec「條款僅於券詳情頁呈現」）。
 */
export function buildCouponMessage(params: { couponName: string; url: string }): string {
  return [`為您準備了一張優惠券：${params.couponName}`, '', '點擊以下連結查看：', params.url].join('\n');
}
