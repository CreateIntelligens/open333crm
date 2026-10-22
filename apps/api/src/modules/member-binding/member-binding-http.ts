/** 會員綁定後台與顧客端路由共用的錯誤對照、輸入格式與交易輔助。 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { inTenant, type TenantCtx } from '../../lib/tenant-ctx.js';
import { eventBus } from '../../events/event-bus.js';
import type { BindingFailureReason } from './member-binding.types.js';

/** 對顧客的說明。技術細節留在 detail 欄位供後台排查，不外露。 */
export const FAILURE_MESSAGES: Record<BindingFailureReason, string> = {
  UPSTREAM_UNREACHABLE: '會員系統暫時無法連線，請稍後再試',
  UPSTREAM_ERROR: '會員系統回應異常，請稍後再試或聯繫客服',
  MEMBER_NOT_FOUND: '查無此會員資料，請確認輸入是否正確',
  NOT_CONFIGURED: '尚未開放會員綁定',
  ALREADY_BOUND_TO_OTHER: '此會員編號已被其他帳號綁定，請聯繫客服',
};

/** 外部系統問題回 502，顧客輸入問題回 404／409 —— 讓監控能區分。 */
export const FAILURE_STATUS: Record<BindingFailureReason, number> = {
  UPSTREAM_UNREACHABLE: 502,
  UPSTREAM_ERROR: 502,
  MEMBER_NOT_FOUND: 404,
  NOT_CONFIGURED: 400,
  ALREADY_BOUND_TO_OTHER: 409,
};

/** 顧客或客服輸入的識別資料（會員編號、手機等），一律是文字 */
export const lookupInputSchema = z.record(z.string().max(200, '輸入內容過長'), { invalid_type_error: '輸入格式不正確' });
export const contactParams = z.object({ contactId: z.string().uuid('聯絡人識別格式不正確') });

/** 在指定租戶的交易內執行（顧客端與連線測試用；後台的一般端點用 tenantHandler） */
export function runInTenant<T>(app: FastifyInstance, tenantId: string, fn: (ctx: TenantCtx) => Promise<T>) {
  return inTenant({ prisma: app.prisma, io: app.io, events: eventBus }, tenantId, fn);
}
