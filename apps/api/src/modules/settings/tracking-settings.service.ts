/**
 * 追蹤設定（GA4／Meta Pixel）讀寫。格式驗證在路由層（trackingSettingsSchema）。
 */
import type { TenantDb } from '../../lib/tenant-db.js';

const TRACKING_SELECT = { gaId: true, metaPixelId: true } as const;

/** 讀取追蹤設定；租戶還沒有設定列時建立一列 */
export async function getTrackingSettings(prisma: TenantDb, tenantId: string) {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: TRACKING_SELECT,
  });
  if (settings) return settings;
  return prisma.tenantSettings.create({ data: { tenantId }, select: TRACKING_SELECT });
}

/** 寫入追蹤設定；null 代表清除 */
export async function updateTrackingSettings(
  prisma: TenantDb,
  tenantId: string,
  data: { gaId: string | null; metaPixelId: string | null },
) {
  return prisma.tenantSettings.upsert({
    where: { tenantId },
    create: { tenantId, ...data },
    update: data,
    select: TRACKING_SELECT,
  });
}
