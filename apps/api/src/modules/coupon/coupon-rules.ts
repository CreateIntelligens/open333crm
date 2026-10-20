/**
 * 優惠券後台的純規則（不碰資料庫）：店員驗證碼格式、發布後鎖定欄位。
 * 前端表單與後端 service 共用同一套判斷，文案依《優惠券後台 UX 規則》。
 */

/** 店員驗證碼格式錯誤時回傳訊息，合法時回傳 null。驗證碼一律以字串處理，開頭的 0 不可去掉。 */
export function staffCodeError(code: string): string | null {
  if (!/^\d{4,6}$/.test(code)) return '需 4–6 位數字';
  const digits = [...code].map(Number);
  const allSame = digits.every((d) => d === digits[0]);
  const step = digits[1] - digits[0];
  const sequential = (step === 1 || step === -1) && digits.every((d, i) => i === 0 || d - digits[i - 1] === step);
  if (allSame || sequential) return '請避免使用連續或重複的數字';
  return null;
}

/**
 * 發布後不可修改的欄位：改了會讓已發出的券與當初的承諾不一致
 * （面額、效期、券號、核銷方式），或讓座席能不能發券的判斷改變（用途）。
 */
export const LOCKED_FIELDS = [
  'couponType', 'discountAmount', 'discountPercent', 'minSpend', 'percentCap',
  'giftName', 'giftQty', 'exchangeItem', 'exchangeValueCap', 'purpose',
  'validityMode', 'startAt', 'endAt', 'afterClaimDays', 'afterOpenMinutes',
  'codeMode', 'codePrefix', 'sharedCode', 'redeemMode', 'staffCode',
] as const;

const DATE_FIELDS = new Set(['startAt', 'endAt']);
const UPPERCASE_FIELDS = new Set(['codePrefix', 'sharedCode']);

function normalize(field: string, value: unknown): unknown {
  if (value === undefined || value === null || value === '') return null;
  if (DATE_FIELDS.has(field)) {
    const t = new Date(value as string | Date).getTime();
    return Number.isNaN(t) ? value : t;
  }
  if (UPPERCASE_FIELDS.has(field) && typeof value === 'string') return value.trim().toUpperCase();
  return value;
}

/** 回傳本次輸入中「值真的改變」的鎖定欄位名稱；只送出原值不算修改。 */
export function findLockedChanges(existing: Record<string, unknown>, input: Record<string, unknown>): string[] {
  return LOCKED_FIELDS.filter(
    (field) => input[field] !== undefined && normalize(field, input[field]) !== normalize(field, existing[field]),
  );
}
