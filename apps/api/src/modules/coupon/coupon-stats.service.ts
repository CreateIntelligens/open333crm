/**
 * 券成效統計與名單匯出。
 *
 * 定位是「證明哪則訊息帶來核銷」，因此指標要能回答「發出去的券有沒有被用」，
 * 而非只有發送量。核銷率以「已核銷 ÷ 已領取」計算——用發送量當分母會把
 * 沒人領的券也算進去，讓數字失真。
 */
import type { Prisma } from '@prisma/client';
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
  /** 序號包匯入的序號總數（含已配發）；非序號包模式為 null */
  poolSize: number | null;
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
  const coupon = await db.coupon.findFirst({ where: { id: couponId, tenantId }, select: { id: true, codeMode: true } });
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

  const poolSize =
    coupon.codeMode === 'IMPORTED_CODES'
      ? await db.couponCode.count({ where: { couponId, tenantId } })
      : null;

  return {
    couponId,
    poolSize,
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
/**
 * CSV 儲存格。以 = + - @ 或 Tab、換行開頭的值，Excel 會當成公式執行（持有者名稱來自顧客自訂的暱稱），
 * 前面加單引號當成文字。
 */
export function csvCell(v: unknown): string {
  if (v == null) return '""';
  const text = String(v);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function formatDate(d: Date | null): string {
  return d ? d.toISOString() : '';
}

export interface InstanceListOptions {
  /** 序號（忽略連字號、空白與大小寫）或顧客名稱 */
  q?: string;
  /** 「已領取」篩選同時包含已開啟（OPENED）——對客服而言兩者都是「在顧客手上、還沒用」 */
  status?: string;
  claimedFrom?: Date;
  claimedTo?: Date;
  redeemedFrom?: Date;
  redeemedTo?: Date;
  page?: number;
  limit?: number;
}

function dateRange(from?: Date, to?: Date) {
  if (!from && !to) return undefined;
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
}

/**
 * 序號明細（每頁預設 50 筆，依領取時間由新到舊；未領取的排最後）。
 * 序號搜尋要忽略連字號與大小寫，Prisma 的 where 做不到字串正規化，
 * 故先以原生 SQL 找出符合的 id，再交給一般查詢套用其他篩選與分頁。
 */
export async function listInstances(
  db: TenantDb,
  tenantId: string,
  couponId: string,
  opts: InstanceListOptions = {},
) {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));

  const where: Prisma.CouponInstanceWhereInput = { couponId, tenantId };
  if (opts.status === 'CLAIMED') where.status = { in: ['CLAIMED', 'OPENED'] };
  else if (opts.status) where.status = opts.status as never;
  const claimedAt = dateRange(opts.claimedFrom, opts.claimedTo);
  if (claimedAt) where.claimedAt = claimedAt;
  const redeemedAt = dateRange(opts.redeemedFrom, opts.redeemedTo);
  if (redeemedAt) where.redeemedAt = redeemedAt;

  const q = opts.q?.trim();
  if (q) {
    const normalized = q.replace(/[-\s]/g, '').toUpperCase();
    const codeMatches = normalized
      ? await db.$queryRaw<{ id: string }[]>`
          SELECT id FROM coupon_instances
          WHERE "tenantId" = ${tenantId}::uuid AND "couponId" = ${couponId}::uuid
            AND upper(regexp_replace(code, '[-[:space:]]', '', 'g')) LIKE ${'%' + normalized + '%'}`
      : [];
    where.OR = [
      { id: { in: codeMatches.map((r) => r.id) } },
      { contact: { displayName: { contains: q, mode: 'insensitive' } } },
    ];
  }

  const [items, total] = await Promise.all([
    db.couponInstance.findMany({
      where,
      include: { contact: { select: { id: true, displayName: true } } },
      orderBy: [{ claimedAt: { sort: 'desc', nulls: 'last' } }, { issuedAt: 'desc' }],
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

// ── 數據報表：優惠券成效（spec「數據報表呈現優惠券成效」） ──────────────────

export interface CouponAnalytics {
  /** 期間內發出的券（依發出時間），以及其中已領取、已核銷的張數 */
  totals: { issued: number; claimed: number; redeemed: number; redeemRate: number | null };
  /** 每日發出與核銷張數（台灣日期，design D17）；只列有資料的日期 */
  trend: { date: string; issued: number; redeemed: number }[];
  /** 期間內發出的券依核銷數排序，前 10 名 */
  topCoupons: { couponId: string; name: string; issued: number; claimed: number; redeemed: number; redeemRate: number | null }[];
}

const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

export async function getCouponAnalytics(db: TenantDb, tenantId: string, from: Date, to: Date): Promise<CouponAnalytics> {
  // 發送中的券（對話發券還在等渠道回應，design D16）不計入
  const perCoupon = await db.$queryRaw<{ coupon_id: string; name: string; issued: bigint; claimed: bigint; redeemed: bigint }[]>`
    SELECT i."couponId" AS coupon_id, c.name,
      COUNT(*)::bigint AS issued,
      COUNT(*) FILTER (WHERE i.status IN ('CLAIMED', 'OPENED', 'REDEEMED'))::bigint AS claimed,
      COUNT(*) FILTER (WHERE i.status = 'REDEEMED')::bigint AS redeemed
    FROM coupon_instances i
    JOIN coupons c ON c.id = i."couponId"
    WHERE i."tenantId" = ${tenantId}::uuid
      AND i."issuedAt" >= ${from} AND i."issuedAt" <= ${to}
      AND i."deliveryPendingAt" IS NULL
    GROUP BY 1, 2
  `;
  const coupons = perCoupon.map((r) => {
    const issued = Number(r.issued);
    const claimed = Number(r.claimed);
    const redeemed = Number(r.redeemed);
    return { couponId: r.coupon_id, name: r.name, issued, claimed, redeemed, redeemRate: rate(redeemed, claimed) };
  });
  const sum = (key: 'issued' | 'claimed' | 'redeemed') => coupons.reduce((n, c) => n + c[key], 0);
  const totals = { issued: sum('issued'), claimed: sum('claimed'), redeemed: sum('redeemed'), redeemRate: rate(sum('redeemed'), sum('claimed')) };

  // 台灣日期分日：發出依 issuedAt、核銷依 redeemedAt，各自落在期間內才算
  const trendRows = await db.$queryRaw<{ day: string; issued: bigint; redeemed: bigint }[]>`
    SELECT day, SUM(issued)::bigint AS issued, SUM(redeemed)::bigint AS redeemed FROM (
      SELECT to_char(("issuedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD') AS day, 1 AS issued, 0 AS redeemed
      FROM coupon_instances
      WHERE "tenantId" = ${tenantId}::uuid AND "issuedAt" >= ${from} AND "issuedAt" <= ${to} AND "deliveryPendingAt" IS NULL
      UNION ALL
      SELECT to_char(("redeemedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD'), 0, 1
      FROM coupon_instances
      WHERE "tenantId" = ${tenantId}::uuid AND status = 'REDEEMED' AND "redeemedAt" >= ${from} AND "redeemedAt" <= ${to}
    ) t
    GROUP BY day
    ORDER BY day
  `;
  const trend = trendRows.map((r) => ({ date: r.day, issued: Number(r.issued), redeemed: Number(r.redeemed) }));

  const topCoupons = [...coupons]
    .sort((a, b) => b.redeemed - a.redeemed || b.issued - a.issued || a.name.localeCompare(b.name))
    .slice(0, 10);
  return { totals, trend, topCoupons };
}
