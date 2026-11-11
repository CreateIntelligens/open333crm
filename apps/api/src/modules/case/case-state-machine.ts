import { canTransition, VALID_CASE_TRANSITIONS } from '@open333crm/shared';
import type { CaseStatus } from '@open333crm/shared';
import { AppError } from '../../shared/utils/response.js';

const STATUS_LABELS: Record<CaseStatus, string> = {
  OPEN: '開啟',
  IN_PROGRESS: '處理中',
  PENDING: '待處理',
  RESOLVED: '已解決',
  ESCALATED: '已升級',
  CLOSED: '已關閉',
};

export function validateTransition(from: CaseStatus, to: CaseStatus): void {
  if (!canTransition(from, to)) {
    // 訊息會直接顯示給客服（S05：原本是英文），列出可以改成的狀態讓客服知道下一步
    const allowed = (VALID_CASE_TRANSITIONS[from] ?? []).map((s) => STATUS_LABELS[s] ?? s).join('、');
    throw new AppError(
      `工單狀態不能從「${STATUS_LABELS[from] ?? from}」直接改成「${STATUS_LABELS[to] ?? to}」${allowed ? `，可改成：${allowed}` : ''}`,
      'INVALID_TRANSITION',
      422,
      { from, to },
    );
  }
}
