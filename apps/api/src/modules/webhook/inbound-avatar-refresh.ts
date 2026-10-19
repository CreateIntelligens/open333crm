/**
 * 進站時把渠道身分的頭像補存進物件儲存（spec inbound-contact-resolution「渠道頭像存進物件儲存」，AUDIT IDENT-06）。
 *
 * 在背景執行，不延後訊息落地。新身分的網址剛取得、直接下載；舊身分的網址可能已失效，
 * 下載失敗時向平台重新取得一次。失敗後一小時內同一身分不再重試，避免每則訊息都呼叫平台 API。
 */
import { logger } from '@open333crm/core';
import { deleteStoredAvatar, isStoredAvatarUrl, mirrorAvatar } from '../storage/avatar-mirror.service.js';
import type { InboundMessageContext } from './inbound-message.types.js';

const RETRY_AFTER_MS = 60 * 60 * 1000;
const DEFAULT_MAX_TRACKED = 10_000;
let maxTracked = DEFAULT_MAX_TRACKED;

/** 身分 id → 上次嘗試補存的時間（只在這個程序內，重啟後重新計算） */
const lastAttemptAt = new Map<string, number>();
const pending = new Set<Promise<void>>();

export interface AvatarIdentity {
  id: string;
  contactId: string;
  profilePic: string | null;
}

function shouldAttempt(identityId: string, now: number): boolean {
  const last = lastAttemptAt.get(identityId);
  if (last !== undefined && now - last < RETRY_AFTER_MS) return false;
  lastAttemptAt.delete(identityId); // 重新放到最後，Map 的順序就是嘗試時間的先後
  if (lastAttemptAt.size >= maxTracked) {
    for (const [id, at] of lastAttemptAt) {
      if (now - at >= RETRY_AFTER_MS) lastAttemptAt.delete(id);
    }
    // 一小時內失敗的身分仍超過上限時，淘汰最舊的，記憶體才有上限
    for (const id of lastAttemptAt.keys()) {
      if (lastAttemptAt.size < maxTracked) break;
      lastAttemptAt.delete(id);
    }
  }
  lastAttemptAt.set(identityId, now);
  return true;
}

async function refreshIdentityAvatar(ctx: InboundMessageContext, identity: AvatarIdentity): Promise<void> {
  const previous = identity.profilePic;
  if (!previous || isStoredAvatarUrl(ctx.tenantId, previous)) return;
  if (!shouldAttempt(identity.id, Date.now())) return;

  let stored = await mirrorAvatar(ctx.tenantId, previous);
  if (!stored && ctx.plugin) {
    try {
      const profile = await ctx.plugin.getProfile(ctx.contactUid, ctx.credentials);
      if (profile.avatarUrl && profile.avatarUrl !== previous) {
        stored = await mirrorAvatar(ctx.tenantId, profile.avatarUrl);
      }
    } catch {
      // 讀不到就等下次
    }
  }
  if (!stored) return;

  // 只在網址仍是補存前那一個時寫入：期間被客服同步或另一個程序先存好，就不覆蓋
  let updated: { count: number };
  try {
    updated = await ctx.prisma.channelIdentity.updateMany({
      where: { id: identity.id, profilePic: previous, contact: { tenantId: ctx.tenantId } },
      data: { profilePic: stored },
    });
  } catch (err) {
    // 沒寫進資料庫的檔案沒人找得到，資料刪除也刪不到，先刪掉
    await deleteStoredAvatar(ctx.tenantId, stored);
    throw err;
  }
  if (updated.count === 0) {
    await deleteStoredAvatar(ctx.tenantId, stored);
    return;
  }
  // 聯絡人的頭像只在來自這個身分時更新，客服改過的不覆蓋
  await ctx.prisma.contact.updateMany({
    where: { id: identity.contactId, tenantId: ctx.tenantId, avatarUrl: previous },
    data: { avatarUrl: stored },
  });
  lastAttemptAt.delete(identity.id);
}

/** 在背景補存頭像；失敗只記 log，不影響進站流程 */
export function scheduleAvatarRefresh(ctx: InboundMessageContext, identity: AvatarIdentity): void {
  const job = refreshIdentityAvatar(ctx, identity)
    .catch((err) => {
      logger.warn('[AvatarRefresh] 補存頭像失敗', err);
    })
    .finally(() => pending.delete(job));
  pending.add(job);
}

/** 測試用：等目前排入的補存全部結束 */
export async function flushAvatarRefreshesForTests(): Promise<void> {
  await Promise.all([...pending]);
}

/** 測試用：清掉重試間隔的紀錄，可另外指定紀錄上限 */
export function resetAvatarRefreshThrottleForTests(limit = DEFAULT_MAX_TRACKED): void {
  lastAttemptAt.clear();
  maxTracked = limit;
}
