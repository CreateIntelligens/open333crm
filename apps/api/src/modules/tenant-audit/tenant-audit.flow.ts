/**
 * 租戶稽核查詢的 flow（#337 階段 3，AGENTS.md 結構規則 2）。
 *
 * 寫稽核不經過這裡：各模組的 flow 在自己的交易內呼叫 recordTenantAudit()。
 */
import { flowOf } from '../../lib/tenant-ctx.js';
import { listTenantAudit } from './tenant-audit.service.js';

export const listTenantAuditFlow = flowOf(listTenantAudit);
