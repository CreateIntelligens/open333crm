/**
 * 發券核心邏輯（可共用於 apps/api 與 apps/workers）。
 *
 * 為何放 core：關鍵字／加好友觸發的發券在 **workers** 執行，而 workers 不能
 * 相依 apps/api。把配額檢查與券碼配發放這裡，兩端共用同一套規則——
 * 若各寫一份，總量上限在兩條路徑上會不一致。
 *
 * ⚠️ 本檔收「已綁定租戶的交易 client」而非自建交易：租戶注入機制
 * （withTenant／SET LOCAL）屬 apps/api，由呼叫端負責。
 */
import { randomBytes, randomInt } from 'node:crypto';
import type { Prisma } from '@prisma/client';

export type CouponTx = Prisma.TransactionClient;

/** 券碼字集：去除 0/O/1/I/L，避免店員口頭覆述與手動輸入時誤判。 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const DEFAULT_CODE_LENGTH = 10;

/** 領取憑證預設有效 72 小時（design D10：短效、一次性）。 */
export const DEFAULT_CLAIM_TOKEN_HOURS = 72;

export function generateCouponCode(prefix?: string | null, length = DEFAULT_CODE_LENGTH): string {
  let body = '';
  for (let i = 0; i < length; i += 1) {
    body += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  const p = prefix?.trim().toUpperCase();
  return p ? `${p}-${body}` : body;
}

/** 憑證即所有權，必須用 CSPRNG——可預測的憑證等同券可被猜中領走。 */
export function generateClaimToken(): string {
  return randomBytes(32).toString('base64url');
}

export type IssueSkipReason =
  | 'TOTAL_LIMIT_REACHED'
  | 'PER_CONTACT_LIMIT_REACHED'
  | 'CODES_EXHAUSTED'
  | 'SHARED_CODE_MISSING'
  | 'CODE_GENERATION_FAILED'
  | 'CODE_ALLOCATION_CONFLICT';

export interface IssuedInstance {
  id: string;
  contactId: string | null;
  code: string;
  status: string;
  claimToken: string | null;
}

export interface IssueOutcome {
  issued: IssuedInstance[];
  skipped: Array<{ contactId: string; reason: IssueSkipReason }>;
}

interface CouponForIssue {
  id: string;
  codeMode: string;
  sharedCode: string | null;
  codePrefix: string | null;
  validityMode: string;
  endAt: Date | null;
  afterClaimDays: number | null;
  totalLimit: number | null;
  perContactLimit: number;
}

/**
 * 依 codeMode 取得券碼。IMPORTED_CODES 以條件式更新搶佔庫存，
 * 避免兩張券拿到同一個序號。
 */
async function allocateCode(
  tx: CouponTx,
  tenantId: string,
  coupon: CouponForIssue,
): Promise<{ ok: true; code: string } | { ok: false; reason: IssueSkipReason }> {
  if (coupon.codeMode === 'SHARED_CODE') {
    if (!coupon.sharedCode) return { ok: false, reason: 'SHARED_CODE_MISSING' };
    return { ok: true, code: coupon.sharedCode };
  }

  if (coupon.codeMode === 'IMPORTED_CODES') {
    const candidate = await tx.couponCode.findFirst({
      where: { couponId: coupon.id, tenantId, status: 'AVAILABLE' },
      orderBy: { createdAt: 'asc' },
    });
    if (!candidate) return { ok: false, reason: 'CODES_EXHAUSTED' };
    const taken = await tx.couponCode.updateMany({
      where: { id: candidate.id, tenantId, status: 'AVAILABLE' },
      data: { status: 'ASSIGNED' },
    });
    if (taken.count === 0) return { ok: false, reason: 'CODE_ALLOCATION_CONFLICT' };
    return { ok: true, code: candidate.code };
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCouponCode(coupon.codePrefix);
    const exists = await tx.couponInstance.findFirst({
      where: { tenantId, code },
      select: { id: true },
    });
    if (!exists) return { ok: true, code };
  }
  return { ok: false, reason: 'CODE_GENERATION_FAILED' };
}

function computeExpiresAt(coupon: CouponForIssue, claimed: boolean): Date | null {
  if (coupon.validityMode === 'FIXED') return coupon.endAt;
  if (coupon.validityMode === 'AFTER_CLAIM' && claimed && coupon.afterClaimDays) {
    return new Date(Date.now() + coupon.afterClaimDays * 24 * 60 * 60 * 1000);
  }
  return null;
}

export interface IssueParams {
  tenantId: string;
  coupon: CouponForIssue;
  contactIds: string[];
  issuedVia?: string | null;
  issuedRefId?: string | null;
  /** true → 建 ISSUED + claimToken（FB／IG、公開領券）；false → 直接 CLAIMED（LINE） */
  requireClaim: boolean;
  claimTokenHours?: number;
}

/**
 * 在既有交易內發券。逐筆處理：部分對象因配額被略過時，
 * 其餘仍應成功——整批失敗會讓座席不知道哪些人拿到了。
 */
export async function issueInstances(tx: CouponTx, params: IssueParams): Promise<IssueOutcome> {
  const { tenantId, coupon, requireClaim } = params;
  const issued: IssuedInstance[] = [];
  const skipped: IssueOutcome['skipped'] = [];

  for (const contactId of params.contactIds) {
    if (coupon.totalLimit != null) {
      // 每發一張都重查——同一批內也會累加，用批次開始時的數字會超發
      const total = await tx.couponInstance.count({ where: { couponId: coupon.id, tenantId } });
      if (total >= coupon.totalLimit) {
        skipped.push({ contactId, reason: 'TOTAL_LIMIT_REACHED' });
        continue;
      }
    }

    const held = await tx.couponInstance.count({
      where: {
        couponId: coupon.id,
        tenantId,
        contactId,
        // 已核銷／已失效不佔額度，否則回頭客永遠拿不到第二張
        status: { in: ['ISSUED', 'CLAIMED', 'OPENED'] },
      },
    });
    if (held >= coupon.perContactLimit) {
      skipped.push({ contactId, reason: 'PER_CONTACT_LIMIT_REACHED' });
      continue;
    }

    const allocated = await allocateCode(tx, tenantId, coupon);
    if (!allocated.ok) {
      skipped.push({ contactId, reason: allocated.reason });
      continue;
    }

    const now = new Date();
    const instance = await tx.couponInstance.create({
      data: {
        tenantId,
        couponId: coupon.id,
        contactId,
        code: allocated.code,
        status: requireClaim ? 'ISSUED' : 'CLAIMED',
        claimToken: requireClaim ? generateClaimToken() : null,
        claimTokenExpiresAt: requireClaim
          ? new Date(Date.now() + (params.claimTokenHours ?? DEFAULT_CLAIM_TOKEN_HOURS) * 60 * 60 * 1000)
          : null,
        claimedAt: requireClaim ? null : now,
        expiresAt: computeExpiresAt(coupon, !requireClaim),
        issuedVia: params.issuedVia ?? null,
        issuedRefId: params.issuedRefId ?? null,
      },
    });

    issued.push({
      id: instance.id,
      contactId: instance.contactId,
      code: instance.code,
      status: instance.status,
      claimToken: instance.claimToken,
    });
  }

  return { issued, skipped };
}
