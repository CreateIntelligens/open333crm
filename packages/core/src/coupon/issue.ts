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

/**
 * 券號的比對鍵：去掉英數以外的字元並轉大寫。核銷台手動輸入時不必打連字號；
 * 資料庫以同一個運算式建唯一索引（migration 20261021110000），去掉連字號後相同的兩組券號不能並存。
 */
export function couponCodeKey(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
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
  /** 只會發已發布的券，發布時已檢查必填；草稿的 null 不會走到這裡 */
  codeMode: string | null;
  sharedCode: string | null;
  codePrefix: string | null;
  validityMode: string | null;
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
): Promise<{ ok: true; code: string; poolCodeId?: string } | { ok: false; reason: IssueSkipReason }> {
  // 共用碼：顧客看到的是共用碼，但每張券仍有自己的內部券號（以共用碼為前綴），
  // 核銷台掃 QR Code 才分得出是哪一位顧客的券
  let prefix = coupon.codePrefix;
  if (coupon.codeMode === 'SHARED_CODE') {
    if (!coupon.sharedCode) return { ok: false, reason: 'SHARED_CODE_MISSING' };
    prefix = coupon.sharedCode;
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
    return { ok: true, code: candidate.code, poolCodeId: candidate.id };
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCouponCode(prefix);
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
  /** 發放當下的來源名稱與座席名稱快照；來源之後刪除或改名，明細仍顯示原名 */
  issuedSourceName?: string | null;
  issuedByName?: string | null;
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

  // 鎖住這張券到交易結束：兩個請求同時發同一張券時依序處理，
  // 否則兩邊都數到「還沒達上限」，每人上限與發行總量會超發（design D14）
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${coupon.id}, 0))`;

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
        // 領過就算（含已使用），已過期與已撤回不算（2026-10-21 依對話發券設計稿決定，design D14）
        status: { in: ['ISSUED', 'CLAIMED', 'OPENED', 'REDEEMED'] },
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
        issuedSourceName: params.issuedSourceName ?? null,
        issuedByName: params.issuedByName ?? null,
      },
    });
    // 序號包：記錄這組序號配發給哪一張券，之後查得到序號的去向
    if (allocated.poolCodeId) {
      await tx.couponCode.updateMany({
        where: { id: allocated.poolCodeId, tenantId },
        data: { instanceId: instance.id },
      });
    }

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

/** 各發放方式的預設來源名稱（序號明細的「發放來源」）。群發、活動等有自己名稱的來源由呼叫端傳入。 */
const SOURCE_NAME: Record<string, string> = {
  inbox: '對話發券',
  keyword: '關鍵字',
  'keyword.matched': '關鍵字',
  automation: '自動化',
};

/**
 * 發放方式的預設來源名稱。workers 以觸發事件名稱（例如 message.received）當發放方式，
 * 沒有個別名稱的事件一律視為「自動化」。
 */
export function couponSourceName(issuedVia: string | null | undefined): string | undefined {
  if (!issuedVia) return undefined;
  return SOURCE_NAME[issuedVia] ?? (issuedVia.includes('.') ? '自動化' : undefined);
}

const CLAIM_TAG_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 領券自動貼標（對話發券與自動化發券共用）。只貼這個租戶、適用於聯絡人的標籤；
 * 設了時效就寫入到期時間（重複貼標時續期），交給 tag-expiry 排程移除。
 * 回傳貼上的標籤，讓呼叫端各自發出 contact.tagged 事件；沒有貼回傳 null。
 */
export async function applyCouponClaimTag(
  tx: CouponTx,
  tenantId: string,
  contactId: string,
  coupon: { claimTagId: string | null; claimTagTtlDays: number | null },
  now: number = Date.now(),
): Promise<{ tagId: string; tagName: string } | null> {
  if (!coupon.claimTagId) return null;
  const tag = await tx.tag.findFirst({
    where: { id: coupon.claimTagId, tenantId, scope: 'CONTACT' },
    select: { id: true, name: true },
  });
  if (!tag) return null;
  const expiresAt = coupon.claimTagTtlDays ? new Date(now + coupon.claimTagTtlDays * CLAIM_TAG_DAY_MS) : null;
  await tx.contactTag.upsert({
    where: { contactId_tagId: { contactId, tagId: tag.id } },
    update: { expiresAt },
    // 非人工路徑，標記來源為 system 以便日後區分
    create: { contactId, tagId: tag.id, addedBy: 'system', expiresAt },
  });
  return { tagId: tag.id, tagName: tag.name };
}
