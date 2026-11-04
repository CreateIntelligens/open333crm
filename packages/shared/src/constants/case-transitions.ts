import type { CaseStatus } from '../types/case.types';

export const VALID_CASE_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  OPEN: ['IN_PROGRESS', 'CLOSED'],
  IN_PROGRESS: ['PENDING', 'RESOLVED', 'ESCALATED', 'CLOSED'],
  PENDING: ['IN_PROGRESS', 'ESCALATED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  ESCALATED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: ['OPEN'],
};

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return VALID_CASE_TRANSITIONS[from]?.includes(to) ?? false;
}

/** 狀態轉換時要寫入或清除的時間欄位（值為 null 表示清除） */
export interface CaseTransitionTimestamps {
  resolvedAt?: Date | null;
  closedAt?: Date;
}

/**
 * 工單從 from 轉成 to 時要寫入的時間欄位（issue #417）。API 的 transitionCase() 與 workers 的
 * update_case_status 動作都用這個函式，報表以 resolvedAt 判斷「已解決」：
 * - 轉成 RESOLVED：寫入 resolvedAt。
 * - 轉成 CLOSED：寫入 closedAt。從 RESOLVED 關閉保留原本的 resolvedAt；直接關閉（沒有經過 RESOLVED）
 *   不算已解決，resolvedAt 為 null。
 * - 轉成其他狀態（重開、處理中、待處理、升級）：清除 resolvedAt，重開的工單不再算已解決。
 * - 狀態沒有改變：不動任何欄位。
 * 只計算欄位，不檢查轉換是否合法；合法性由 canTransition() 判斷。closedAt 重開時保留（不在 #417 範圍）。
 */
export function caseTransitionTimestamps(from: CaseStatus, to: CaseStatus, now: Date): CaseTransitionTimestamps {
  if (from === to) return {};
  if (to === 'RESOLVED') return { resolvedAt: now };
  if (to === 'CLOSED') return from === 'RESOLVED' ? { closedAt: now } : { closedAt: now, resolvedAt: null };
  return { resolvedAt: null };
}
