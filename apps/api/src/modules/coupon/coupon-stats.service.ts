/**
 * 券成效統計與名單匯出。
 *
 * 定位是「證明哪則訊息帶來核銷」，因此指標要能回答「發出去的券有沒有被用」，
 * 而非只有發送量。核銷率以「已核銷 ÷ 已領取」計算——用發送量當分母會把
 * 沒人領的券也算進去，讓數字失真。
 */
import type { TenantDb } from '../../lib/tenant-db.js';

export interface CouponStats {
  couponId: string;
  /** 發出的總張數 */
  issued: number;
  /** 已歸戶（含後續已開啟／已核銷） */
  claimed: number;
  /** 已開啟（含已核銷） */
  opened: number;
  redeemed: number;
  expired: number;
  revoked: number;
  /** 尚待領取（FB／IG 憑證未使用） */
  pendingClaim: number;
  /** 已核銷 ÷ 已領取。無人領取時為 null，不是 0——沒有分母不等於成效為零 */
  redeemRate: number | null;
  /** 已領取 ÷ 發出。衡量發券訊息的吸引力 */
  claimRate: number | null;
}

export async function getCouponStats(
  db: TenantDb,
  tenantId: string,
  couponId: string,
): Promise<CouponStats | null> {
  const coupon = await db.coupon.findFirst({ where: { id: couponId, tenantId }, select: { id: true } });
  if (!coupon) return null;

  // 用逐一 count 而非 groupBy —— TenantDb 是三種 client 的聯集，
  // groupBy 的泛型簽名在聯集下不相容（TS2349）。count 在三者皆可用。
  const statuses = ['ISSUED', 'CLAIMED', 'OPENED', 'REDEEMED', 'EXPIRED', 'REVOKED'] as const;
  const counts = await Promise.all(
    statuses.map((status) =>
      db.couponInstance.count({ where: { couponId, tenantId, status } }),
    ),
  );
  const [pendingClaim, claimedOnly, openedOnly, redeemed, expired, revoked] = counts;

  const issued = pendingClaim + claimedOnly + openedOnly + redeemed + expired + revoked;
  // 累積口徑：已開啟與已核銷的券都曾經被領取過
  const claimed = claimedOnly + openedOnly + redeemed;
  const opened = openedOnly + redeemed;

  return {
    couponId,
    issued,
    claimed,
    opened,
    redeemed,
    expired,
    revoked,
    pendingClaim,
    redeemRate: claimed > 0 ? Math.round((redeemed / claimed) * 1000) / 10 : null,
    claimRate: issued > 0 ? Math.round((claimed / issued) * 1000) / 10 : null,
  };
}

/** CSV 欄位一律加引號並轉義內部引號——券名與券碼來自使用者輸入，可能含逗號。 */
function csvCell(v: unknown): string {
  if (v == null) return '""';
  return `"${String(v).replace(/"/g, '""')}"`;
}

function formatDate(d: Date | null): string {
  return d ? d.toISOString() : '';
}

export interface InstanceListOptions {
  status?: string;
  page?: number;
  limit?: number;
}

export async function listInstances(
  db: TenantDb,
  tenantId: string,
  couponId: string,
  opts: InstanceListOptions = {},
) {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  const where = {
    couponId,
    tenantId,
    ...(opts.status ? { status: opts.status as never } : {}),
  };

  const [items, total] = await Promise.all([
    db.couponInstance.findMany({
      where,
      include: { contact: { select: { id: true, displayName: true } } },
      orderBy: { issuedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.couponInstance.count({ where }),
  ]);
  return { items, total, page, limit };
}

/**
 * 領取名單匯出。刻意不含 claimToken——那是有效憑證，匯出即等同外流可領取的券。
 */
export async function exportInstancesCsv(
  db: TenantDb,
  tenantId: string,
  couponId: string,
): Promise<string> {
  const instances = await db.couponInstance.findMany({
    where: { couponId, tenantId },
    include: { contact: { select: { displayName: true } } },
    orderBy: { issuedAt: 'desc' },
  });

  const headers = [
    '券號', '狀態', '持有者', '發放來源', '發放時間',
    '領取時間', '開啟時間', '核銷時間', '核銷方式', '到期時間',
  ].map(csvCell).join(',');

  const rows = instances.map((i) =>
    [
      csvCell(i.code),
      csvCell(i.status),
      csvCell(i.contact?.displayName ?? ''),
      csvCell(i.issuedVia ?? ''),
      csvCell(formatDate(i.issuedAt)),
      csvCell(formatDate(i.claimedAt)),
      csvCell(formatDate(i.openedAt)),
      csvCell(formatDate(i.redeemedAt)),
      csvCell(i.redeemMode ?? ''),
      csvCell(formatDate(i.expiresAt)),
    ].join(','),
  );

  // BOM 讓 Excel 正確辨識 UTF-8，否則中文會變亂碼
  return `﻿${headers}\n${rows.join('\n')}`;
}

/** 券列表頁用的彙總：一次取多張券的核銷數，避免 N+1 查詢。 */
export async function getBulkRedeemCounts(
  db: TenantDb,
  tenantId: string,
  couponIds: string[],
): Promise<Map<string, { issued: number; redeemed: number }>> {
  const result = new Map<string, { issued: number; redeemed: number }>();
  if (couponIds.length === 0) return result;

  // 同上：避開 groupBy 的聯集型別問題。每張券兩個 count，
  // 列表頁一頁至多數十張券，成本可接受。
  await Promise.all(
    couponIds.map(async (couponId) => {
      const [issued, redeemed] = await Promise.all([
        db.couponInstance.count({ where: { tenantId, couponId } }),
        db.couponInstance.count({ where: { tenantId, couponId, status: 'REDEEMED' } }),
      ]);
      result.set(couponId, { issued, redeemed });
    }),
  );
  return result;
}
