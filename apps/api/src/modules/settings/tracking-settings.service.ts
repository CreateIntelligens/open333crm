/**
 * 追蹤設定（GA4／Meta Pixel）讀寫。格式驗證在路由層（trackingSettingsSchema）。
 */
import type { TenantCtx } from '../../lib/tenant-ctx.js';

const TRACKING_SELECT = { gaId: true, metaPixelId: true } as const;

/** 讀取追蹤設定；租戶還沒有設定列時建立一列 */
export async function getTrackingSettings(ctx: TenantCtx) {
  const settings = await ctx.tx.tenantSettings.findUnique({
    where: { tenantId: ctx.tenantId },
    select: TRACKING_SELECT,
  });
  if (settings) return settings;
  return ctx.tx.tenantSettings.create({ data: { tenantId: ctx.tenantId }, select: TRACKING_SELECT });
}

/** 寫入追蹤設定；null 代表清除 */
export async function updateTrackingSettings(
  ctx: TenantCtx,
  data: { gaId: string | null; metaPixelId: string | null },
) {
  return ctx.tx.tenantSettings.upsert({
    where: { tenantId: ctx.tenantId },
    create: { tenantId: ctx.tenantId, ...data },
    update: data,
    select: TRACKING_SELECT,
  });
}
