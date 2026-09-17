/**
 * 序號包匯入（IMPORTED_CODES 模式）。
 *
 * 匯入必須是「可預期的部分成功」：一批一萬筆裡有三筆重複，不應整批退回。
 * 因此逐筆分類為 成功／清單內重複／與既有券碼衝突／格式錯誤，各自回報
 * ——只回「匯入失敗」會讓商家無從修正。
 */
import type { PrismaClient } from '@prisma/client';
import { withTenant } from '../../lib/tenant-db.js';
import { parseCodeList, normalizeImportedCode } from './coupon-code.service.js';
import { CouponValidationError } from './coupon.service.js';

/** 單次匯入上限。過大的批次會讓交易持有過久，拖累其他請求。 */
const MAX_CODES_PER_IMPORT = 10_000;

export interface ImportResult {
  /** 實際寫入的筆數 */
  imported: number;
  /** 同一批輸入內重複，只取第一筆 */
  duplicatesInInput: string[];
  /** 與 DB 既有券碼衝突（同租戶內券碼須唯一） */
  conflicts: string[];
  /** 格式不符 */
  invalid: string[];
  /** 匯入後該券的可用庫存總數 */
  availableTotal: number;
}

export async function importCodes(
  prisma: PrismaClient,
  tenantId: string,
  couponId: string,
  rawInput: string,
): Promise<ImportResult> {
  const parsed = parseCodeList(rawInput);

  if (parsed.valid.length === 0) {
    throw new CouponValidationError(
      parsed.invalid.length > 0 ? '沒有格式正確的券碼可匯入' : '請提供要匯入的券碼',
    );
  }
  if (parsed.valid.length > MAX_CODES_PER_IMPORT) {
    throw new CouponValidationError(`單次最多匯入 ${MAX_CODES_PER_IMPORT} 筆，請分批進行`);
  }

  return withTenant(prisma, tenantId, async (tx) => {
    const coupon = await tx.coupon.findFirst({ where: { id: couponId, tenantId } });
    if (!coupon) throw new CouponValidationError('查無此券');
    if (coupon.codeMode !== 'IMPORTED_CODES') {
      throw new CouponValidationError('僅序號包模式的券可匯入序號');
    }
    // 已結束的券不再收序號——庫存加了也發不出去
    if (coupon.status === 'ENDED') {
      throw new CouponValidationError('已結束的券無法匯入序號');
    }

    // 與既有券碼比對。券碼在租戶內唯一，故同時查庫存表與已發出的券
    const [existingCodes, existingInstances] = await Promise.all([
      tx.couponCode.findMany({
        where: { tenantId, code: { in: parsed.valid } },
        select: { code: true },
      }),
      tx.couponInstance.findMany({
        where: { tenantId, code: { in: parsed.valid } },
        select: { code: true },
      }),
    ]);
    const taken = new Set([
      ...existingCodes.map((c) => c.code),
      ...existingInstances.map((c) => c.code),
    ]);

    const conflicts: string[] = [];
    const toInsert: string[] = [];
    for (const code of parsed.valid) {
      if (taken.has(code)) conflicts.push(code);
      else toInsert.push(code);
    }

    if (toInsert.length > 0) {
      await tx.couponCode.createMany({
        data: toInsert.map((code) => ({ tenantId, couponId, code, status: 'AVAILABLE' as const })),
        // 併發匯入同一組碼時，唯一約束會擋下後到者；跳過而非整批失敗
        skipDuplicates: true,
      });
    }

    const availableTotal = await tx.couponCode.count({
      where: { couponId, tenantId, status: 'AVAILABLE' },
    });

    return {
      imported: toInsert.length,
      duplicatesInInput: parsed.duplicatesInInput,
      conflicts,
      invalid: parsed.invalid,
      availableTotal,
    };
  });
}

/** 匯入前試算，讓使用者在確認前看到會發生什麼。不寫入任何資料。 */
export async function previewImport(
  prisma: PrismaClient,
  tenantId: string,
  rawInput: string,
): Promise<Omit<ImportResult, 'imported' | 'availableTotal'> & { willImport: number }> {
  const parsed = parseCodeList(rawInput);

  return withTenant(prisma, tenantId, async (tx) => {
    const [existingCodes, existingInstances] = await Promise.all([
      tx.couponCode.findMany({ where: { tenantId, code: { in: parsed.valid } }, select: { code: true } }),
      tx.couponInstance.findMany({ where: { tenantId, code: { in: parsed.valid } }, select: { code: true } }),
    ]);
    const taken = new Set([
      ...existingCodes.map((c) => c.code),
      ...existingInstances.map((c) => c.code),
    ]);
    const conflicts = parsed.valid.filter((c) => taken.has(c));

    return {
      willImport: parsed.valid.length - conflicts.length,
      duplicatesInInput: parsed.duplicatesInInput,
      conflicts,
      invalid: parsed.invalid,
    };
  });
}

/**
 * 移除尚未配發的序號。已配發者（ASSIGNED）不可刪——顧客手上的券會查無此碼。
 */
export async function removeAvailableCode(
  prisma: PrismaClient,
  tenantId: string,
  couponId: string,
  code: string,
): Promise<{ removed: boolean; reason?: 'NOT_FOUND' | 'ALREADY_ASSIGNED' }> {
  const normalized = normalizeImportedCode(code);
  return withTenant(prisma, tenantId, async (tx) => {
    const existing = await tx.couponCode.findFirst({
      where: { tenantId, couponId, code: normalized },
    });
    if (!existing) return { removed: false, reason: 'NOT_FOUND' as const };
    if (existing.status === 'ASSIGNED') {
      return { removed: false, reason: 'ALREADY_ASSIGNED' as const };
    }
    const result = await tx.couponCode.deleteMany({
      where: { id: existing.id, tenantId, status: 'AVAILABLE' },
    });
    return { removed: result.count > 0 };
  });
}
