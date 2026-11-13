/**
 * 留言自動私訊在背景（收件、送出）的使用資格（change add-comment-keyword-private-reply design D22）。
 *
 * 路由由權限天花板擋住方案不含 `comment_reply` 的租戶；背景工作沒有經過天花板，所以在這裡自己查：
 * 1. 平台緊急停止
 * 2. 平台的私訊能力開關（fbPrivateReply／igPrivateReply）
 * 3. 租戶啟用中
 * 4. 方案含 `comment_reply`（planId 為 null 視為含，與權限天花板一致）
 *
 * 方案每次都查（一筆以主鍵查詢）：平台在方案移除功能後，已排隊的工作要馬上略過（spec「排隊期間方案移除功能」）。
 * 平台設定由呼叫端以 readCommentReplyPlatformSettings() 讀入（60 秒快取）。
 */
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { capabilityName, type CommentReplyPlatformSettings } from './comment-reply-platform-settings.js';
import { isCommentReplyPlanEnabled } from './comment-reply-plan.js';

export type CommentReplyPlatform = 'fb' | 'ig';

export type CommentReplyDenyReason = 'EMERGENCY_STOPPED' | 'CAPABILITY_DISABLED' | 'TENANT_DISABLED' | 'PLAN_FEATURE_DISABLED';

export type CommentReplyEntitlement = { ok: true } | { ok: false; reason: CommentReplyDenyReason };

/** 只看平台設定的部分（不碰資料庫）：緊急停止、私訊能力 */
export function checkPlatformSwitches(
  settings: CommentReplyPlatformSettings,
  platform: CommentReplyPlatform,
): CommentReplyEntitlement {
  if (settings.emergencyStop.stopped) return { ok: false, reason: 'EMERGENCY_STOPPED' };
  if (!settings.capabilities[capabilityName(platform, 'PrivateReply')]) return { ok: false, reason: 'CAPABILITY_DISABLED' };
  return { ok: true };
}

/** 租戶啟用中且方案含 comment_reply；租戶查不到視為停用 */
export async function checkTenantEntitlement(ctx: TenantCtx): Promise<CommentReplyEntitlement> {
  const tenant = await ctx.tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { isActive: true } });
  if (!tenant?.isActive) return { ok: false, reason: 'TENANT_DISABLED' };
  return (await isCommentReplyPlanEnabled(ctx.tx, ctx.tenantId)) ? { ok: true } : { ok: false, reason: 'PLAN_FEATURE_DISABLED' };
}

/** 背景用的完整檢查：先看平台設定（不查資料庫），再看租戶與方案 */
export async function checkCommentReplyEntitlement(
  ctx: TenantCtx,
  settings: CommentReplyPlatformSettings,
  platform: CommentReplyPlatform,
): Promise<CommentReplyEntitlement> {
  const platformCheck = checkPlatformSwitches(settings, platform);
  if (!platformCheck.ok) return platformCheck;
  return checkTenantEntitlement(ctx);
}
