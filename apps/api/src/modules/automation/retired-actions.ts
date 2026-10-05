import type { PrismaClient } from '@open333crm/database';

/**
 * 2026-10-05 從契約拿掉的自動化動作（AUDIT AUTO-01，issue #197）。
 * workers 從未實作；含這些動作的既有規則，契約驗證失敗、workers 整條略過。
 */
export const RETIRED_AUTOMATION_ACTION_TYPES: ReadonlySet<string> = new Set(['assign_bot', 'kb_auto_reply', 'llm_reply']);

/** 移除規則動作中已拿掉的類型，其他動作保留原順序 */
export function stripRetiredActions(actions: unknown): { actions: unknown[]; removed: string[] } {
  if (!Array.isArray(actions)) return { actions: [], removed: [] };
  const removed: string[] = [];
  const kept = actions.filter((action) => {
    const type = (action as { type?: unknown } | null)?.type;
    if (typeof type === 'string' && RETIRED_AUTOMATION_ACTION_TYPES.has(type)) {
      removed.push(type);
      return false;
    }
    return true;
  });
  return { actions: kept, removed };
}

export interface RetiredActionCleanup {
  id: string;
  tenantId: string;
  name: string;
  removed: string[];
  /** 移除後剩下的動作數 */
  remaining: number;
  /** 是否已寫入（dry-run 或移除後沒有動作時為 false） */
  updated: boolean;
}

type CleanupDb = Pick<PrismaClient, 'tenant' | 'automationRule'>;

/**
 * 找出（並在 apply 時移除）各租戶規則中已拿掉的動作。逐租戶查詢，每個 query 都帶 tenantId。
 * 移除後沒有任何動作的規則不寫入：建立規則要求至少一個動作，留給管理員決定要刪除或改設定。
 */
export async function removeRetiredActions(prisma: CleanupDb, options: { apply: boolean }): Promise<RetiredActionCleanup[]> {
  const report: RetiredActionCleanup[] = [];
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  for (const { id: tenantId } of tenants) {
    const rules = await prisma.automationRule.findMany({
      where: { tenantId, enabled: true },
      select: { id: true, tenantId: true, name: true, actions: true },
    });
    for (const rule of rules) {
      const { actions, removed } = stripRetiredActions(rule.actions);
      if (removed.length === 0) continue;
      const writable = options.apply && actions.length > 0;
      if (writable) {
        await prisma.automationRule.updateMany({
          where: { id: rule.id, tenantId },
          data: { actions: actions as never },
        });
      }
      report.push({ id: rule.id, tenantId, name: rule.name, removed, remaining: actions.length, updated: writable });
    }
  }
  return report;
}
