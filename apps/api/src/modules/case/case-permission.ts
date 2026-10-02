/**
 * 工單的條件式權限檢查（AUDIT RBAC-01）。工單路由與對話路由（從對話建工單）共用，所以獨立成檔。
 */
import { requirePermissionWhen } from '../../guards/rbac.guard.js';

/** body 帶負責人或團隊（含設為 null 取消指派）時，另需 case.assign */
export const caseAssignIfAssigning = requirePermissionWhen('case.assign', (request) => {
  const body = request.body as { assigneeId?: unknown; teamId?: unknown } | undefined;
  return body?.assigneeId !== undefined || body?.teamId !== undefined;
});
