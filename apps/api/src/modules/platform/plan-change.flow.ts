/**
 * 租戶送出方案異動申請的 flow（change add-plan-change-platform-notify）。
 *
 * 建立申請之後寄信通知所有啟用中的平台帳號。寄信不擋回應：路由回應申請，不等 `notification`。
 * 寄送結果一律寫一筆平台稽核 `plan_change.notify_platform`，寄送失敗查得到收件人與原因，不是只在 log。
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { logger } from '@open333crm/core';
import { getConfig } from '../../config/env.js';
import { createPlanChangeRequest, getPlanChangeNotifyContext } from './plan-change.service.js';
import { sendPlanChangeRequestedEmail } from './platform-user-emails.js';
import { writePlatformAudit } from './platform-audit.service.js';

type CreatePlanChangeInput = Parameters<typeof createPlanChangeRequest>[2];
type PlanChangeRequestRow = Awaited<ReturnType<typeof createPlanChangeRequest>>;

export interface PlanChangeNotifyResult {
  recipients: number;
  sent: number;
  failed: Array<{ email: string; reason: string }>;
  /** 查詢收件人等寄信之前的步驟失敗時的原因 */
  error?: string;
}

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);

/**
 * 建立申請並開始通知平台帳號。
 * `notification` 不會 reject，路由不必等它；測試可以 await 它確認寄送結果。
 */
export async function submitPlanChangeRequest(
  deps: { prisma: PrismaClient },
  tenantId: string,
  input: CreatePlanChangeInput,
): Promise<{ request: PlanChangeRequestRow; notification: Promise<PlanChangeNotifyResult> }> {
  const request = await createPlanChangeRequest(deps.prisma, tenantId, input);
  return { request, notification: notifyPlatformOfPlanChange(deps, request) };
}

/**
 * 寄信給所有啟用中的平台帳號，再把結果寫進平台稽核。
 * 任何錯誤都在這裡處理，回傳的 promise 不會 reject。
 */
export async function notifyPlatformOfPlanChange(
  deps: { prisma: PrismaClient },
  request: PlanChangeRequestRow,
): Promise<PlanChangeNotifyResult> {
  const result: PlanChangeNotifyResult = { recipients: 0, sent: 0, failed: [] };
  try {
    const ctx = await getPlanChangeNotifyContext(deps.prisma, request);
    result.recipients = ctx.recipients.length;
    const vars = {
      tenantName: ctx.tenantName,
      type: request.type as 'upgrade' | 'token_topup',
      targetPlanName: ctx.targetPlanName,
      topupTokens: request.topupTokens,
      note: request.note,
      reviewUrl: `${getConfig().WEB_BASE_URL}/admin/plan-changes`,
    };
    const outcomes = await Promise.allSettled(ctx.recipients.map((r) => sendPlanChangeRequestedEmail(r.email, vars)));
    outcomes.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled') result.sent += 1;
      else result.failed.push({ email: ctx.recipients[i].email, reason: reasonOf(outcome.reason) });
    });
  } catch (err) {
    result.error = reasonOf(err);
  }

  if (result.error || result.failed.length > 0) {
    logger.error(
      `[PlanChange] 通知平台帳號失敗 request=${request.id} ${JSON.stringify({ error: result.error, failed: result.failed })}`,
    );
  } else if (result.recipients === 0) {
    logger.warn(`[PlanChange] 沒有啟用中的平台帳號可通知 request=${request.id}`);
  }

  const { error, ...counts } = result;
  try {
    await writePlatformAudit(deps.prisma, {
      platformUserId: null,
      action: 'plan_change.notify_platform',
      targetType: 'plan_change_request',
      targetId: request.id,
      payload: {
        tenantId: request.tenantId,
        type: request.type,
        ...counts,
        ...(error ? { error } : {}),
      } as Prisma.InputJsonValue,
    });
  } catch (err) {
    // 稽核寫不進去時只能留 log，不可以變成 unhandled rejection
    logger.error(`[PlanChange] 寫入通知稽核失敗 request=${request.id}: ${reasonOf(err)}`);
  }
  return result;
}
