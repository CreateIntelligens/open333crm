/**
 * 追蹤設定（GA4／Meta Pixel）讀寫。格式驗證在路由層（trackingSettingsSchema）。
 */
import { createOrFindExisting } from '@open333crm/core';
import type { TenantCtx } from '../../lib/tenant-ctx.js';

const TRACKING_SELECT = { gaId: true, metaPixelId: true } as const;

/**
 * 讀取追蹤設定。租戶還沒有設定列時建立一列；
 * 同時有另一個請求建立時，改用對方建立的那一列（createOrFindExisting）。
 */
export async function getTrackingSettings(ctx: TenantCtx) {
  const find = () => ctx.tx.tenantSettings.findUnique({ where: { tenantId: ctx.tenantId }, select: TRACKING_SELECT });
  const settings = await find();
  if (settings) return settings;
  const { row } = await createOrFindExisting(
    () =>
      ctx.tx.tenantSettings.createManyAndReturn({
        data: [{ tenantId: ctx.tenantId }],
        skipDuplicates: true,
        select: TRACKING_SELECT,
      }),
    find,
  );
  return row;
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
