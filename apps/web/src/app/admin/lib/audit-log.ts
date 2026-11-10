/**
 * 平台稽核紀錄的顯示規則（規格 platform-audit-log）：動作中文名稱、對象文字與連結。
 * 租戶詳細頁與平台帳號詳細頁共用（AuditLogTable）。
 */
import { pad2, taipeiParts } from '../../../lib/taipei-time';

/** API 回傳的平台稽核紀錄（GET /tenants/:id/audit-logs、GET /platform-users/:id/audit-logs） */
export interface PlatformAuditEntry {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
  targetLabel: string | null;
  targetTenantId: string | null;
}

/**
 * 稽核 action → 中文名稱。新增平台稽核動作時要一併補上，否則畫面顯示代碼。
 * 清單來源：`git grep -n "action: '" apps/api/src` 與 trial.scheduler 的系統排程動作。
 */
export const PLATFORM_AUDIT_ACTION_LABELS: Record<string, string> = {
  'platform_user.provision': '開通平台帳號',
  'platform_user.update': '編輯平台帳號',
  'platform_user.enable': '啟用平台帳號',
  'platform_user.disable': '停用平台帳號',
  'platform_user.resend_welcome': '重寄平台帳號開通信',
  'platform_user.change_password': '修改密碼',
  'tenant.provision': '開通租戶',
  'tenant.update': '編輯租戶資料',
  'tenant.enable': '啟用租戶',
  'tenant.disable': '停用租戶',
  'tenant.contract.update': '修改合約期間',
  'tenant.agent.email.update': '修改成員 Email',
  'tenant.agent.resend_welcome': '重寄成員開通信',
  'tenant.ai_privacy.update': '修改 AI 個資遮罩設定',
  'tenant.trial.extend': '延長試用',
  'tenant.trial.convert': '試用轉正式方案',
  'tenant.trial.restore': '復原已清除的試用租戶',
  'tenant.trial.expire': '試用到期停用',
  'tenant.trial.purge': '清除試用租戶資料',
  'trial.signup.fail': '標記試用申請失敗',
  'plan.update': '修改方案',
  'plan_change.approve': '核准方案申請',
  'plan_change.reject': '駁回方案申請',
  'setting.update': '修改平台設定',
  'queue.job.retry': '重送佇列工作',
};

/** 動作中文名稱；表中沒有的顯示原始代碼 */
export function auditActionLabel(action: string): string {
  return PLATFORM_AUDIT_ACTION_LABELS[action] ?? action;
}

/** 對象文字：可讀名稱優先；查不到時退回「類型 / 代碼前 8 碼」 */
export function auditTargetText(entry: Pick<PlatformAuditEntry, 'targetType' | 'targetId' | 'targetLabel'>): string {
  if (entry.targetLabel) return entry.targetLabel;
  if (!entry.targetType) return '—';
  return entry.targetId ? `${entry.targetType} / ${entry.targetId.slice(0, 8)}…` : entry.targetType;
}

/** 對象連結；沒有對應頁面的類型回 null */
export function auditTargetHref(
  entry: Pick<PlatformAuditEntry, 'targetType' | 'targetId' | 'targetTenantId'>,
): string | null {
  switch (entry.targetType) {
    case 'tenant':
    case 'agent':
    case 'plan_change_request':
      return entry.targetTenantId ? `/admin/tenants/${entry.targetTenantId}` : null;
    case 'plan':
      return '/admin/plans';
    case 'platform_user':
      return entry.targetId ? `/admin/platform-users/${entry.targetId}` : null;
    case 'trial_signup':
      return '/admin/trial';
    default:
      return null;
  }
}

/** 稽核時間以台灣時間顯示 YYYY-MM-DD HH:mm */
export function fmtAuditTime(iso: string): string {
  const p = taipeiParts(iso);
  return p ? `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}` : '—';
}
