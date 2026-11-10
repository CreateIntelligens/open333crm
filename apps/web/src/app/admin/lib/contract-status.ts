// 平台後台的租戶合約到期狀態（change add-contract-expiry-reminder）。
// 天數以日曆日計算：迄日的日期 − 今天的本地日期，與 API 合約提醒排程的台灣日曆日一致。

const DAY_MS = 86_400_000;
export const EXPIRING_WITHIN_DAYS = 30;

export type ContractStatus = 'expired' | 'expiring';

/** 本地今天的日期，以該日 UTC 00:00 的毫秒數表示 */
function todayUtcMs(today: Date): number {
  return Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
}

/**
 * @description 合約剩餘天數
 * @param contractEndDate API 回傳的迄日（ISO 字串，取日期部分）
 * @param today 今天（預設現在）
 * @returns 迄日當天為 0、已過期為負數；沒有迄日回 null
 */
export function contractDaysLeft(contractEndDate: string | null, today: Date = new Date()): number | null {
  if (!contractEndDate) return null;
  const end = Date.parse(contractEndDate.slice(0, 10) + 'T00:00:00.000Z');
  return Math.round((end - todayUtcMs(today)) / DAY_MS);
}

/** 已過期、30 天內到期，或不需標示（null） */
export function contractStatus(contractEndDate: string | null, today: Date = new Date()): ContractStatus | null {
  const left = contractDaysLeft(contractEndDate, today);
  if (left === null) return null;
  if (left < 0) return 'expired';
  if (left <= EXPIRING_WITHIN_DAYS) return 'expiring';
  return null;
}

export const CONTRACT_STATUS_META: Record<ContractStatus, { label: string; color: string; background: string }> = {
  expired: { label: '已過期', color: '#d1443e', background: '#fdecea' },
  expiring: { label: '30 天內到期', color: '#b7791f', background: '#fdf3e1' },
};

// ── 合約到期提醒天數（平台設定 contract.reminderDaysBefore）──

export const CONTRACT_REMINDER_DAYS_KEY = 'contract.reminderDaysBefore';
export const DEFAULT_CONTRACT_REMINDER_DAYS = [30, 7, 1];
export const MAX_CONTRACT_REMINDER_DAY = 365;

/** 檔位陣列 → 顯示用字串，例如 "30, 7, 1" */
export function formatReminderDays(days: number[]): string {
  return days.join(', ');
}

/**
 * @description 解析使用者輸入的提醒天數（與 API 的 parseContractReminderDays 規則一致）
 * @param input 逗號分隔的天數，例如 "7, 30, 7"
 * @returns 合法時回去重、由大到小排序的天數；不合法時回原因（不改用預設值）
 */
export function parseReminderDaysInput(input: string): { ok: true; days: number[] } | { ok: false; error: string } {
  const parts = input.split(/[,，]/).map((p) => p.trim());
  if (parts.every((p) => p === '')) return { ok: false, error: '請輸入提醒天數' };
  const valid = parts.every((p) => /^\d+$/.test(p) && Number(p) >= 1 && Number(p) <= MAX_CONTRACT_REMINDER_DAY);
  if (!valid) return { ok: false, error: `提醒天數只能是 1 到 ${MAX_CONTRACT_REMINDER_DAY} 的整數，以逗號分隔` };
  return { ok: true, days: [...new Set(parts.map(Number))].sort((a, b) => b - a) };
}

/** 依合約迄日排序（asc：近到遠），沒有迄日的一律排最後 */
export function sortByContractEnd<T extends { contractEndDate: string | null }>(rows: T[], dir: 'asc' | 'desc'): T[] {
  return [...rows].sort((a, b) => {
    if (!a.contractEndDate || !b.contractEndDate) {
      return (a.contractEndDate ? 0 : 1) - (b.contractEndDate ? 0 : 1);
    }
    const diff = Date.parse(a.contractEndDate) - Date.parse(b.contractEndDate);
    return dir === 'asc' ? diff : -diff;
  });
}
