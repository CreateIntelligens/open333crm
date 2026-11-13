/**
 * 收件用的規則快取（change add-comment-keyword-private-reply design D4）。
 *
 * 每則留言都要讀渠道的啟用規則；`feed` 事件量大時不能每則都查資料庫。程序內快取 30 秒，
 * 規則異動時以 Redis 版本號 `cr:rules-ver:<channelId>` 讓所有 API 實例的快取立即失效：
 * 收件時先 GET 版本號（一次 Redis 往返），與快取記下的版本不同就重讀。
 *
 * 規則異動的路由（建立、修改、刪除、啟用切換、排序）在交易提交後呼叫 bumpCommentReplyRulesVersion()。
 * Redis 讀不到版本號時不用快取，直接查資料庫（寧可多查，也不能用到舊規則）。
 */
import type { Redis } from 'ioredis';
import type { IntakeRule } from './comment-reply-intake.service.js';

export const COMMENT_REPLY_RULE_CACHE_TTL_MS = 30_000;

/** 與後台 API（wip/cr-routes）的 comment-reply-rule.service.ts 同名、同值；合併時收成一份 */
export const commentReplyRulesVersionKey = (channelId: string) => `cr:rules-ver:${channelId}`;

/** 規則異動後呼叫：遞增版本號，所有實例的快取在下一則留言時重讀 */
export async function bumpCommentReplyRulesVersion(redis: Pick<Redis, 'incr'>, channelId: string): Promise<void> {
  await redis.incr(commentReplyRulesVersionKey(channelId));
}

interface Entry {
  version: string;
  rules: IntakeRule[];
  expiresAt: number;
}

const cache = new Map<string, Entry>();

/**
 * 取渠道的規則：版本號相同且未過期時用快取，否則呼叫 load() 重讀。
 * redis 為 undefined（測試或沒有 Redis 的呼叫端）時不使用快取。
 */
export async function getCachedRules(
  redis: Pick<Redis, 'get'> | undefined,
  channelId: string,
  load: () => Promise<IntakeRule[]>,
  now: number = Date.now(),
): Promise<IntakeRule[]> {
  let version: string | null = null;
  if (redis) {
    try {
      version = (await redis.get(commentReplyRulesVersionKey(channelId))) ?? '0';
    } catch {
      version = null;
    }
  }
  if (version === null) return load();

  const hit = cache.get(channelId);
  if (hit && hit.version === version && hit.expiresAt > now) return hit.rules;
  const rules = await load();
  cache.set(channelId, { version, rules, expiresAt: now + COMMENT_REPLY_RULE_CACHE_TTL_MS });
  return rules;
}

/** 測試用：清空程序內快取 */
export function clearCommentReplyRuleCache(): void {
  cache.clear();
}
