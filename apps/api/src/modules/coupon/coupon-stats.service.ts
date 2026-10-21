/**
 * 券成效統計與名單匯出。
 *
 * 定位是「證明哪則訊息帶來核銷」，因此指標要能回答「發出去的券有沒有被用」，
 * 而非只有發送量。核銷率以「已核銷 ÷ 已領取」計算——用發送量當分母會把
 * 沒人領的券也算進去，讓數字失真。
 */
import type { Prisma } from '@prisma/client';
import { taipeiDateStart, taipeiDateString } from '@open333crm/core';
import type { TenantCtx } from '../../lib/tenant-ctx.js';

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
  /** 票券連結至少被開啟過一次的張數（點擊歸因，design D21） */
  linkOpened: number;
  /** 已核銷 ÷ 已領取。無人領取時為 null，不是 0——沒有分母不等於成效為零 */
  redeemRate: number | null;
  /** 已領取 ÷ 發出。衡量發券訊息的吸引力 */
  claimRate: number | null;
}

export async function getCouponStats(
  ctx: TenantCtx,
  couponId: string,
): Promise<CouponStats | null> {
  const db = ctx.tx;
  const { tenantId } = ctx;
  const coupon = await db.coupon.findFirst({ where: { id: couponId, tenantId }, select: { id: true, codeMode: true } });
  if (!coupon) return null;

  // 逐一 count 各狀態
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

  const linkOpened = await db.couponInstance.count({ where: { couponId, tenantId, linkOpenedAt: { not: null } } });

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
    linkOpened,
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
  ctx: TenantCtx,
  couponId: string,
  opts: InstanceListOptions = {},
) {
  const db = ctx.tx;
  const { tenantId } = ctx;
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
      // 領取憑證是有效的領券權杖：拿到就能把還沒領的券領走，不能回給後台
      omit: { claimToken: true, claimTokenExpiresAt: true },
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
/** 匯出一頁讀取的筆數：背景匯出每頁一個交易，要在 5 秒的交易時限內完成 */
export const EXPORT_PAGE_SIZE = 2000;

type ExportRow = Prisma.CouponInstanceGetPayload<{ include: { contact: { select: { displayName: true } } } }>;

/** 讀一頁序號明細（依 id 排序，以 afterId 接續）；回傳空陣列表示讀完 */
export async function readInstancesForExport(
  ctx: TenantCtx,
  couponId: string,
  afterId: string | null,
  take: number = EXPORT_PAGE_SIZE,
): Promise<ExportRow[]> {
  return ctx.tx.couponInstance.findMany({
    where: { couponId, tenantId: ctx.tenantId, ...(afterId ? { id: { gt: afterId } } : {}) },
    include: { contact: { select: { displayName: true } } },
    orderBy: { id: 'asc' },
    take,
  });
}

/** 序號明細轉成 CSV（含 BOM）。依發放時間由新到舊排序 */
export function instancesToCsv(instances: ExportRow[]): string {
  const headers = [
    '券號', '狀態', '持有者', '發放來源', '發放時間',
    '領取時間', '開啟時間', '核銷時間', '核銷方式', '到期時間',
  ].map(csvCell).join(',');

  const rows = [...instances]
    .sort((x, y) => y.issuedAt.getTime() - x.issuedAt.getTime())
    .map((i) =>
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

/** 直接下載（筆數不多）：在同一個交易內讀完 */
/** 在租戶交易內執行；入口以 inTenant 實作 */
export type RunInTenant = <T>(fn: (ctx: TenantCtx) => Promise<T>) => Promise<T>;

/** 匯出全部明細：每頁一個交易（避開 5 秒的交易時限），讀完再組成 CSV */
export async function exportInstancesCsv(runInTenant: RunInTenant, couponId: string): Promise<string> {
  const all: ExportRow[] = [];
  for (let afterId: string | null = null; ; ) {
    const page = await runInTenant((ctx) => readInstancesForExport(ctx, couponId, afterId));
    all.push(...page);
    if (page.length < EXPORT_PAGE_SIZE) break;
    afterId = page[page.length - 1].id;
  }
  return instancesToCsv(all);
}

/** 券列表頁用的彙總：一次取多張券的核銷數，避免 N+1 查詢。 */
export async function getBulkRedeemCounts(
  ctx: TenantCtx,
  couponIds: string[],
): Promise<Map<string, { issued: number; redeemed: number }>> {
  const db = ctx.tx;
  const { tenantId } = ctx;
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
  totals: { issued: number; claimed: number; redeemed: number; linkOpened: number; redeemRate: number | null };
  /** 每日發出與核銷張數（台灣日期，design D17）；期間內每一天都有一筆，沒有資料為 0 */
  trend: { date: string; issued: number; redeemed: number }[];
  /** 期間內發出的券依核銷數排序，前 10 名 */
  topCoupons: { couponId: string; name: string; issued: number; claimed: number; redeemed: number; linkOpened: number; redeemRate: number | null }[];
}

/** 補齊期間內每一天（台灣日期），圖表的時間軸才是連續的；超過 400 天只列有資料的日期，避免回應過大 */
const MAX_FILL_DAYS = 400;
function fillDays(from: Date, to: Date): string[] {
  const days: string[] = [];
  for (let d = taipeiDateStart(taipeiDateString(from)); d <= to && days.length <= MAX_FILL_DAYS; d = new Date(d.getTime() + 86_400_000)) {
    days.push(taipeiDateString(d));
  }
  return days.length > MAX_FILL_DAYS ? [] : days;
}

const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

export async function getCouponAnalytics(ctx: TenantCtx, from: Date, to: Date): Promise<CouponAnalytics> {
  const db = ctx.tx;
  const { tenantId } = ctx;
  // 發送中的券（對話發券還在等渠道回應，design D16）不計入
  const perCoupon = await db.$queryRaw<{ coupon_id: string; name: string; issued: bigint; claimed: bigint; redeemed: bigint; link_opened: bigint }[]>`
    SELECT i."couponId" AS coupon_id, c.name,
      COUNT(*)::bigint AS issued,
      COUNT(*) FILTER (WHERE i.status IN ('CLAIMED', 'OPENED', 'REDEEMED'))::bigint AS claimed,
      COUNT(*) FILTER (WHERE i.status = 'REDEEMED')::bigint AS redeemed,
      COUNT(*) FILTER (WHERE i."linkOpenedAt" IS NOT NULL)::bigint AS link_opened
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
    const linkOpened = Number(r.link_opened);
    return { couponId: r.coupon_id, name: r.name, issued, claimed, redeemed, linkOpened, redeemRate: rate(redeemed, claimed) };
  });
  const sum = (key: 'issued' | 'claimed' | 'redeemed' | 'linkOpened') => coupons.reduce((n, c) => n + c[key], 0);
  const totals = {
    issued: sum('issued'),
    claimed: sum('claimed'),
    redeemed: sum('redeemed'),
    linkOpened: sum('linkOpened'),
    redeemRate: rate(sum('redeemed'), sum('claimed')),
  };

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
  const byDay = new Map(trendRows.map((r) => [r.day, { date: r.day, issued: Number(r.issued), redeemed: Number(r.redeemed) }]));
  const days = fillDays(from, to);
  const trend = days.length > 0 ? days.map((date) => byDay.get(date) ?? { date, issued: 0, redeemed: 0 }) : [...byDay.values()];

  const topCoupons = [...coupons]
    .sort((a, b) => b.redeemed - a.redeemed || b.issued - a.issued || a.name.localeCompare(b.name))
    .slice(0, 10);
  return { totals, trend, topCoupons };
}
