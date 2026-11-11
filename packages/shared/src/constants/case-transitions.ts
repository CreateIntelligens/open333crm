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

/** 狀態轉換時要清除的滿意度問卷欄位（值為 null 表示清除） */
export interface CaseTransitionCsatFields {
  csatSentAt?: null;
  csatRespondedAt?: null;
}

/**
 * 工單從 from 轉成 to 時要清除的問卷欄位（issue #339 決定 2，csat-survey「工單重新解決時的問卷」）。
 * API 的 transitionCase() 與 workers 的 update_case_status 動作都用這個函式：
 * - 轉成 RESOLVED、還沒有評分：清除上一輪的 csatSentAt 與 csatRespondedAt，問卷排程再寄一份，
 *   逾時以重新寄出的 csatSentAt 起算（不清除的話，上一輪寄出超過 72 小時的工單一分鐘內就被逾時結案）。
 * - 轉成 RESOLVED、已有評分：保留分數與問卷欄位，不再寄問卷，也不逾時結案。
 * - 其他轉換、狀態沒有改變：不動問卷欄位。
 */
export function caseTransitionCsatFields(
  from: CaseStatus,
  to: CaseStatus,
  current: { csatScore: number | null },
): CaseTransitionCsatFields {
  if (from === to || to !== 'RESOLVED') return {};
  if (current.csatScore !== null) return {};
  return { csatSentAt: null, csatRespondedAt: null };
}

/** 組 case.resolved／case.closed 需要的工單資料（轉換前讀到的資料） */
export interface CaseOutcomeSource {
  caseId: string;
  contactId: string;
  channelId: string;
  assigneeId: string | null;
  title: string;
  /** 工單關聯的第一段對話；沒有時事件不帶 conversationId */
  conversationId?: string | null;
}

export interface CaseOutcomeEvent {
  name: 'case.resolved' | 'case.closed';
  payload: Record<string, unknown>;
}

/**
 * 工單轉成已解決、已關閉時要發的事件（issue #469）。API 的 caseTransitionedEffects() 與 workers 的
 * update_case_status 動作共用，兩條路徑送出的事件內容一致。轉成其他狀態時回傳 null。
 */
export function caseStatusOutcomeEvent(toStatus: string, source: CaseOutcomeSource): CaseOutcomeEvent | null {
  if (toStatus !== 'RESOLVED' && toStatus !== 'CLOSED') return null;
  return {
    name: toStatus === 'RESOLVED' ? 'case.resolved' : 'case.closed',
    payload: {
      caseId: source.caseId,
      contactId: source.contactId,
      channelId: source.channelId,
      assigneeId: source.assigneeId,
      title: source.title,
      ...(source.conversationId ? { conversationId: source.conversationId } : {}),
    },
  };
}
