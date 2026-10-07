/**
 * 跨渠道綁定代碼：常數、代碼產生／擷取、Redis 儲存介面（change add-cross-channel-one-id，design D1 / D2 / D9）。
 */
import { randomBytes } from 'node:crypto';
import IORedis from 'ioredis';
import { getConfig } from '../../config/env.js';

/** 代碼有效期（design D1） */
export const BINDING_CODE_TTL_MS = 30 * 60 * 1000;
/** 顧客自助解除綁定的期限（design D8） */
export const SELF_UNBIND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** 每個渠道身分每小時最多發碼次數（design D9） */
export const MAX_ISSUES_PER_HOUR = 5;
/** 每個渠道身分每小時兌換失敗超過此數後不再回覆（design D9） */
export const MAX_FAILURES_PER_HOUR = 10;
export const RATE_WINDOW_MS = 60 * 60 * 1000;

/** 兌換後等待顧客確認的時間（design D7：兌換方須明確確認才合併，防止轉傳連結被冒用） */
export const PENDING_CONFIRM_TTL_MS = 10 * 60 * 1000;
/** 確認綁定的固定回覆字（不開放租戶自訂，避免與綁定／解除關鍵字衝突） */
export const CONFIRM_KEYWORD = '確認綁定';

export const DEFAULT_BIND_KEYWORDS = ['綁定帳號'];
export const DEFAULT_UNBIND_KEYWORDS = ['解除綁定'];
/** email 登記關鍵字預設值（change add-email-identity-merge，design D1） */
export const DEFAULT_EMAIL_KEYWORDS = ['登記email'];

const CODE_PREFIX = 'BIND-';
const CODE_LENGTH = 10;
// Crockford base32（去掉 I L O U，避免與 1 0 V 混淆）
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
// 在整段文字中「搜尋」代碼（不要求整句相符），顧客改動預填文字的前後內容仍可兌換
const CODE_PATTERN = /BIND-([0-9A-HJKMNP-TV-Z]{10})(?![0-9A-Z])/i;

/** 產生 `BIND-` + 10 碼 Crockford base32（約 50 bit；256 可被 32 整除，取餘數不會偏誤） */
export function generateBindingCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let body = '';
  for (const b of bytes) body += ALPHABET[b % ALPHABET.length];
  return CODE_PREFIX + body;
}

/** 從文字或 referral ref 取出綁定代碼並正規化為大寫；沒有則回 null */
export function extractBindingCode(text: string | undefined | null): string | null {
  if (!text) return null;
  const m = CODE_PATTERN.exec(text);
  return m ? CODE_PREFIX + m[1].toUpperCase() : null;
}

// ── Redis 儲存 ──────────────────────────────────────────────────────────────

/** 綁定代碼用到的 Redis 指令子集；以介面注入，測試可換成記憶體實作 */
export interface BindingStore {
  set(key: string, value: string, mode: 'PX', ttlMs: number, condition: 'NX'): Promise<'OK' | null>;
  getdel(key: string): Promise<string | null>;
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  /** 剩餘毫秒；沒有 TTL 回 -1、key 不存在回 -2 */
  pttl(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
}

/** 代碼內容（存於 Redis） */
export interface BindingCodePayload {
  tenantId: string;
  contactId: string;
  channelIdentityId: string;
  channelId: string;
  conversationId: string;
  issuedAt: number;
}

// key 帶 tenantId：他租戶收到的代碼根本查不到，不會誤耗掉原租戶的代碼，也不洩漏代碼是否存在
export const codeKey = (tenantId: string, code: string) => `bindcode:${tenantId}:${code}`;
export const pendingConfirmKey = (tenantId: string, channelIdentityId: string) =>
  `bindcode:pending:${tenantId}:${channelIdentityId}`;
export const issueCounterKey = (channelIdentityId: string) => `bindcode:issue:${channelIdentityId}`;
export const failCounterKey = (channelIdentityId: string) => `bindcode:fail:${channelIdentityId}`;

/**
 * 計數器 +1；回傳目前計數。
 * INCR 後檢查 TTL，沒有就補上：key 在兩個指令之間過期、PEXPIRE 失敗或進程中斷，都會在
 * 下一次呼叫時補回效期，不會留下永不過期的計數器把顧客永久擋住。
 */
export async function bumpCounter(store: BindingStore, key: string, windowMs = RATE_WINDOW_MS): Promise<number> {
  const n = await store.incr(key);
  if ((await store.pttl(key)) < 0) await store.pexpire(key, windowMs);
  return n;
}

export async function readCounter(store: BindingStore, key: string): Promise<number> {
  return Number((await store.get(key)) ?? 0);
}

let redisClient: IORedis | null = null;

/** 正式環境的 Redis 實作（延遲建立連線） */
export function getBindingStore(): BindingStore {
  redisClient ??= new IORedis(getConfig().REDIS_URL, { maxRetriesPerRequest: 2 });
  return redisClient as unknown as BindingStore;
}
