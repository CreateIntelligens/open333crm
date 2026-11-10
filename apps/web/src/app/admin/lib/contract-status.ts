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
