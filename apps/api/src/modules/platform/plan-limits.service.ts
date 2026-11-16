/**
 * 有效數值上限解析。基礎上限 = Tenant.limitOverrides[key] ?? Plan.limits[key]。
 * 回傳 null 代表無上限（值為 null、租戶無 plan、或 plan 未定義該 key）。
 *
 * AI 月額度（monthlyTokens）另外加上本月（台灣時間）已核准的加購量：加購只計入核准當月，
 * 下個月自動回到基礎上限（change make-token-topup-monthly）。基礎上限是 null 時仍是無上限。
 * 有效上限的解析只在這個檔案，其他地方（核准加購、換方案、LLM 呼叫前的檢查）都呼叫這裡。
 */
import type { Prisma } from '@prisma/client';
import { taipeiMonthStart, taipeiNextMonthStart } from '@open333crm/core';
import type { TenantDb } from '../../lib/tenant-db.js';

/** 查當月加購量只需要 planChangeRequest：租戶交易（ctx.tx）、app_admin 連線都可以傳入 */
type TopupExecutor = Pick<Prisma.TransactionClient, 'planChangeRequest'>;

/**
 * 方案與租戶覆寫可設定的數值上限鍵。方案沒有某個鍵＝無上限（null）。
 * maxCommentReplyRules（啟用中的留言私訊規則數）、monthlyCommentReplies（台灣月私訊數）見
 * add-comment-keyword-private-reply design D23 與「上限檢查點」。
 */
export const LIMIT_KEYS = [
  'maxAgents',
  'maxTags',
  'monthlyTokens',
  'maxChannels',
  'maxCommentReplyRules',
  'monthlyCommentReplies',
] as const;

export type LimitKey = (typeof LIMIT_KEYS)[number];

/**
 * @description 給定已載入的 tenant（含 plan）解析有效上限，避免重複查詢。
 * @param tenant 租戶的覆寫值與方案的 limits
 * @param key 上限的 key
 * @param monthlyTopupTokens 本月已核准的加購量，只加在 monthlyTokens 上；不傳時回傳基礎上限
 * @returns 有效上限；null 代表無上限
 */
export function resolveEffectiveLimit(
  tenant: { limitOverrides: unknown; plan: { limits: unknown } | null },
  key: LimitKey,
  monthlyTopupTokens = 0,
): number | null {
  const base = resolveBaseLimit(tenant, key);
  if (key !== 'monthlyTokens' || base === null) return base;
  return base + monthlyTopupTokens;
}

/** 覆寫優先的基礎上限（含覆寫成 null＝無上限） */
function resolveBaseLimit(
  tenant: { limitOverrides: unknown; plan: { limits: unknown } | null },
  key: LimitKey,
): number | null {
  const overrides = (tenant.limitOverrides ?? {}) as Record<string, number | null>;
  if (Object.prototype.hasOwnProperty.call(overrides, key)) {
    return overrides[key]; // 含 null（覆寫成無上限）
  }
  if (!tenant.plan) return null;
  const limits = (tenant.plan.limits ?? {}) as Record<string, number | null>;
  return key in limits ? limits[key] : null;
}

/**
 * @description 租戶在 at 所在台灣月份已核准的加購 token 總和。
 * 一筆加購屬於核准時間（reviewedAt）所在的月份；待審與駁回的申請不算。
 * @param prisma executor（租戶交易或 app_admin 連線）
 * @param tenantId 租戶
 * @param at 決定月份的時間點，預設現在
 * @returns 加購量總和，沒有加購時是 0
 */
export async function sumMonthlyTopupTokens(
  prisma: TopupExecutor,
  tenantId: string,
  at: Date = new Date(),
): Promise<number> {
  const agg = await prisma.planChangeRequest.aggregate({
    where: {
      tenantId,
      type: 'token_topup',
      status: 'approved',
      reviewedAt: { gte: taipeiMonthStart(at), lt: taipeiNextMonthStart(at) },
    },
    _sum: { topupTokens: true },
  });
  return agg._sum.topupTokens ?? 0;
}

/** 查 DB 後解析有效上限。monthlyTokens 含本月已核准的加購量。 */
export async function getEffectiveLimit(
  prisma: TenantDb,
  tenantId: string,
  key: LimitKey,
): Promise<number | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { limitOverrides: true, plan: { select: { limits: true } } },
  });
  if (!tenant) return null;
  if (key !== 'monthlyTokens') return resolveEffectiveLimit(tenant, key);
  const topup = await sumMonthlyTopupTokens(prisma, tenantId);
  return resolveEffectiveLimit(tenant, key, topup);
}

/**
 * @description 上限是否提高。null 是無上限：有限變無上限算提高，無上限變有限不算。
 * @param before 之前的上限
 * @param after 之後的上限
 */
export function isLimitRaised(before: number | null, after: number | null): boolean {
  if (before === null) return false;
  return after === null || after > before;
}

/**
 * @description 換方案是否提高租戶的 AI 月額度。比較換方案前後的基礎上限；
 * 同一個月的加購量兩邊相同，不影響比較。租戶覆寫了 monthlyTokens 時換方案不改變上限。
 * @param tenant 換方案前的租戶（覆寫值與舊方案的 limits）
 * @param newPlan 新方案的 limits
 */
export function monthlyTokensRaisedByPlanChange(
  tenant: { limitOverrides: unknown; plan: { limits: unknown } | null },
  newPlan: { limits: unknown } | null,
): boolean {
  return isLimitRaised(
    resolveEffectiveLimit(tenant, 'monthlyTokens'),
    resolveEffectiveLimit({ limitOverrides: tenant.limitOverrides, plan: newPlan }, 'monthlyTokens'),
  );
}
