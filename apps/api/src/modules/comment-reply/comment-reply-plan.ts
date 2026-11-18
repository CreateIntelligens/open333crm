/**
 * 租戶方案是否含留言自動私訊（change add-comment-keyword-private-reply design D22-1）。
 *
 * 路由由權限天花板擋；沒有 request 的地方（Meta 連結新粉專時決定是否訂 feed、背景收件與送出）呼叫這裡。
 * 租戶沒有方案（planId 為 null）視為開啟，與權限天花板「無方案則不設天花板」一致。
 */
import type { Prisma } from '@prisma/client';

export const COMMENT_REPLY_FEATURE = 'comment_reply';

export async function isCommentReplyPlanEnabled(db: Pick<Prisma.TransactionClient, 'tenant'>, tenantId: string): Promise<boolean> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { planId: true, plan: { select: { features: true } } },
  });
  if (!tenant) return false;
  if (!tenant.planId) return true;
  const features = Array.isArray(tenant.plan?.features) ? (tenant.plan!.features as unknown[]) : [];
  return features.includes(COMMENT_REPLY_FEATURE);
}
