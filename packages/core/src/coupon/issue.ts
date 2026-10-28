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
import { randomInt } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { COUPON_ISSUED_VIA, couponIssuedViaLabel } from '@open333crm/shared';
import { afterClaimExpiry } from './taipei-time.js';

export type CouponTx = Prisma.TransactionClient;

/** 券碼字集：去除 0/O/1/I/L，避免店員口頭覆述與手動輸入時誤判。 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const DEFAULT_CODE_LENGTH = 10;

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
  // NFKC 先把全形英數字轉成半形：中文輸入法在全形模式下打的券號也找得到
  return code.normalize('NFKC').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/**
 * 計入每人上限的券（design D14，2026-10-21 依設計稿決定）：已使用的一律計入；未使用的只算還沒過期的。
 * 已過期與已撤回的不計入。系統沒有排程把券改成 EXPIRED，所以要以效期判斷，不能只看狀態。
 * 發券、領取（改綁）與對話發券面板共用這個條件，三處的上限判斷才會一致。
 */
export function countsTowardContactLimit(now: Date) {
  return {
    OR: [
      { status: 'REDEEMED' as const },
      {
        status: { in: ['ISSUED' as const, 'CLAIMED' as const, 'OPENED' as const] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    ],
  };
}

export type IssueSkipReason =
  | 'TOTAL_LIMIT_REACHED'
  | 'PER_CONTACT_LIMIT_REACHED'
  | 'CODES_EXHAUSTED'
  | 'SHARED_CODE_MISSING'
  | 'CODE_GENERATION_FAILED'
  | 'CODE_ALLOCATION_CONFLICT'
  /** 聯絡人不存在或不屬於本租戶（外鍵檢查不受 RLS 限制，不先擋會建出跨租戶的券或整批失敗） */
  | 'CONTACT_NOT_FOUND'
  /** 固定效期的券到期日已過：發出去一拿到就過期 */
  | 'COUPON_EXPIRED';

export interface IssuedInstance {
  id: string;
  contactId: string | null;
  code: string;
  status: string;
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

/**
 * 固定效期的券是否已過到期日（到期當下起算）。到期後狀態仍是進行中——系統沒有排程自動結束，
 * 也不能自動改成已結束（顧客券夾會顯示「活動已提前結束」而非「已過期」）——
 * 所以每個發券入口除了看狀態，還要用這個判斷擋下，否則發出的券一拿到就過期。
 */
export function isCouponPastFixedEnd(
  coupon: { validityMode: string | null; endAt: Date | null },
  now: Date = new Date(),
): boolean {
  return coupon.validityMode === 'FIXED' && coupon.endAt != null && coupon.endAt.getTime() <= now.getTime();
}

/**
 * 固定效期沒有過期的 Prisma 條件（給 coupon 的 where 用）。用 OR 明列可用情況、不用 NOT：
 * validityMode、endAt 可為 NULL，SQL 的 NOT 遇到 NULL 會把可用的券也排除。
 */
export function couponNotPastFixedEnd(now: Date) {
  return {
    OR: [
      { validityMode: null },
      { validityMode: { in: ['AFTER_CLAIM' as const, 'AFTER_OPEN' as const] } },
      { endAt: null },
      { endAt: { gt: now } },
    ],
  };
}

function computeExpiresAt(coupon: CouponForIssue): Date | null {
  if (coupon.validityMode === 'FIXED') return coupon.endAt;
  if (coupon.validityMode === 'AFTER_CLAIM' && coupon.afterClaimDays) {
    // 領取當天（台灣日期）加 N 天，當天結束時到期（design D17）
    return afterClaimExpiry(new Date(), coupon.afterClaimDays);
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
}

/**
 * 在既有交易內發券。逐筆處理：部分對象因配額被略過時，
 * 其餘仍應成功——整批失敗會讓座席不知道哪些人拿到了。
 */
export async function issueInstances(tx: CouponTx, params: IssueParams): Promise<IssueOutcome> {
  const { tenantId, coupon } = params;
  const issued: IssuedInstance[] = [];
  const skipped: IssueOutcome['skipped'] = [];

  // 鎖住這張券到交易結束：兩個請求同時發同一張券時依序處理，
  // 否則兩邊都數到「還沒達上限」，每人上限與發行總量會超發（design D14）
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${coupon.id}, 0))`;

  const known = new Set(
    (await tx.contact.findMany({ where: { id: { in: params.contactIds }, tenantId }, select: { id: true } })).map((c) => c.id),
  );

  // 最後防線：各入口應先擋下並給清楚訊息，這裡確保任何路徑都不會發出一拿到就過期的券
  if (isCouponPastFixedEnd(coupon, new Date())) {
    return { issued, skipped: params.contactIds.map((contactId) => ({ contactId, reason: 'COUPON_EXPIRED' as const })) };
  }

  for (const contactId of params.contactIds) {
    if (!known.has(contactId)) {
      skipped.push({ contactId, reason: 'CONTACT_NOT_FOUND' });
      continue;
    }
    if (coupon.totalLimit != null) {
      // 每發一張都重查——同一批內也會累加，用批次開始時的數字會超發
      const total = await tx.couponInstance.count({ where: { couponId: coupon.id, tenantId } });
      if (total >= coupon.totalLimit) {
        skipped.push({ contactId, reason: 'TOTAL_LIMIT_REACHED' });
        continue;
      }
    }

    const held = await tx.couponInstance.count({
      where: { couponId: coupon.id, tenantId, contactId, ...countsTowardContactLimit(new Date()) },
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
        // 發券一律直接歸戶（design D30）：發券當下就知道是哪一位聯絡人，狀態為已領取，不產生領取憑證
        status: 'CLAIMED',
        claimedAt: now,
        expiresAt: computeExpiresAt(coupon),
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
    });
  }

  return { issued, skipped };
}

/**
 * 有預設來源名稱的發放方式（design D32）。關鍵字、加好友、自動化的來源名稱是規則名稱，
 * 由呼叫端傳入；這裡的預設只在沒有規則名稱時使用。群發、批次、公開領券有自己的名稱，沒有預設。
 */
const DEFAULT_SOURCE_NAME_CODES: ReadonlySet<string> = new Set([
  COUPON_ISSUED_VIA.INBOX,
  COUPON_ISSUED_VIA.KEYWORD,
  COUPON_ISSUED_VIA.FOLLOW,
  COUPON_ISSUED_VIA.AUTOMATION,
  COUPON_ISSUED_VIA.API,
]);

/**
 * 發放方式的預設來源名稱（序號明細的「發放來源」），文字與後台的發放方式對照表同一份（@open333crm/shared）。
 * 舊資料以觸發事件名稱當發放方式（例如 message.received），沒有個別名稱的事件一律視為「自動化」。
 */
export function couponSourceName(issuedVia: string | null | undefined): string | undefined {
  if (!issuedVia) return undefined;
  if (!DEFAULT_SOURCE_NAME_CODES.has(issuedVia) && !issuedVia.includes('.')) return undefined;
  return couponIssuedViaLabel(issuedVia);
}

const CLAIM_TAG_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 重複貼領券標籤時的到期時間：已是永久的維持永久（手動貼的 VIP 不能變成會被排程刪掉），
 * 都有期限時取較晚的，不把別處設定的較長期限提早。existing 為 undefined 表示還沒有貼。
 */
export function mergeClaimTagExpiry(existing: Date | null | undefined, next: Date | null): Date | null {
  if (existing === undefined) return next;
  if (existing === null || next === null) return null;
  return existing.getTime() >= next.getTime() ? existing : next;
}

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
  const existing = await tx.contactTag.findUnique({
    where: { contactId_tagId: { contactId, tagId: tag.id } },
    select: { expiresAt: true },
  });
  const expiresAt = mergeClaimTagExpiry(
    existing ? existing.expiresAt : undefined,
    coupon.claimTagTtlDays ? new Date(now + coupon.claimTagTtlDays * CLAIM_TAG_DAY_MS) : null,
  );
  await tx.contactTag.upsert({
    where: { contactId_tagId: { contactId, tagId: tag.id } },
    update: { expiresAt },
    // 非人工路徑，標記來源為 system 以便日後區分
    create: { contactId, tagId: tag.id, addedBy: 'system', expiresAt },
  });
  return { tagId: tag.id, tagName: tag.name };
}
