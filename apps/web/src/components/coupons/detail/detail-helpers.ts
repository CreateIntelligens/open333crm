/**
 * 優惠券詳情頁的純函式：發放來源、核銷管道、篩選條件轉換、剪貼簿。
 * 與畫面分開，方便單獨閱讀與測試。
 */
import type { CouponInstanceRow, InstanceQuery, InstanceStatus } from '@/hooks/useCoupons';

/** 詳情頁每頁筆數（UX 規則第 4 節：每頁 50 筆） */
export const INSTANCE_PAGE_SIZE = 50;

/** 超過這個筆數，匯出可能較久（UX 規則：超過 5,000 筆改背景產生，後端尚未實作，見任務 8.22） */
export const LARGE_EXPORT_THRESHOLD = 5000;

export const COUPON_LIST_PATH = '/dashboard/marketing/coupons';

/** 後端 issuedVia 的值 → 發放方式文字。未知的值不顯示代碼，改用「其他方式」。 */
const ISSUED_VIA_LABEL: Record<string, string> = {
  inbox: '對話發券',
  batch: '批次發放',
  campaign: '行銷活動',
  broadcast: '廣播',
  shortlink: '短連結',
  short_link: '短連結',
  automation: '自動化',
  keyword: '關鍵字',
  api: 'API',
  partner: '合作夥伴',
};

export function issuedViaLabel(via: string | null | undefined): string | null {
  if (!via) return null;
  return ISSUED_VIA_LABEL[via] ?? '其他方式';
}

/**
 * 發放來源兩行（UX 規則：上行來源名稱、下行發放方式或座席；不可空白）。
 * - 有來源名稱快照：上行快照名稱；下行座席名稱，沒有座席時寫發放方式。
 * - 沒有快照：上行寫發放方式；有座席時下行寫座席。
 */
export function issuedSourceLines(
  row: Pick<CouponInstanceRow, 'issuedVia' | 'issuedSourceName' | 'issuedByName'>,
): { primary: string; secondary: string | null } {
  const via = issuedViaLabel(row.issuedVia);
  const primary = row.issuedSourceName || via || '未記錄來源';
  let secondary: string | null = row.issuedByName || (row.issuedSourceName ? via : null);
  if (secondary === primary) secondary = null;
  return { primary, secondary };
}

/** 核銷管道文字（序號歷程的「核銷」步驟） */
export function redeemChannelLabel(channel: string | null | undefined): string {
  switch (channel) {
    case 'fan_self':
      return '顧客自助核銷';
    case 'staff_console':
    case null:
    case undefined:
      return '門市核銷';
    default:
      return '已核銷';
  }
}

export interface InstanceFilters {
  q: string;
  status: InstanceStatus | '';
  claimedFrom: string;
  claimedTo: string;
  redeemedFrom: string;
  redeemedTo: string;
}

export const EMPTY_FILTERS: InstanceFilters = {
  q: '',
  status: '',
  claimedFrom: '',
  claimedTo: '',
  redeemedFrom: '',
  redeemedTo: '',
};

export function hasAnyFilter(f: InstanceFilters): boolean {
  return Boolean(f.q.trim() || f.status || f.claimedFrom || f.claimedTo || f.redeemedFrom || f.redeemedTo);
}

/**
 * date input 的 YYYY-MM-DD 轉成 ISO 時間。後端以 gte／lte 比較，
 * 迄日要用當天最後一刻才會包含當天；一律以台灣時間為界（design D17），與列表顯示的日期一致。
 */
function dayBoundary(value: string, end: boolean): string | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00'}+08:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function toInstanceQuery(f: InstanceFilters, page: number): InstanceQuery {
  return {
    q: f.q.trim() || undefined,
    status: f.status || undefined,
    claimedFrom: dayBoundary(f.claimedFrom, false),
    claimedTo: dayBoundary(f.claimedTo, true),
    redeemedFrom: dayBoundary(f.redeemedFrom, false),
    redeemedTo: dayBoundary(f.redeemedTo, true),
    page,
  };
}

/** 寫入剪貼簿；瀏覽器不支援或被拒時回傳 false，由呼叫端顯示失敗訊息 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 下載 Blob 成檔案 */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 延後釋放，避免部分瀏覽器尚未開始下載就失效
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 取 axios 錯誤的 HTTP 狀態碼（只供程式判斷分支，不顯示給使用者） */
export function errorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  return (err as { response?: { status?: number } }).response?.status;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 網址的 id 不是 UUID 時直接視為找不到，不送出請求 */
export function isCouponId(id: string): boolean {
  return UUID_RE.test(id);
}
