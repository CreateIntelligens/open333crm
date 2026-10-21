/**
 * Socket 推播的種類與房間（主規格 tenant-transaction-context「推播的房間由系統決定」）。
 *
 * service 只說「什麼東西變了」，房間由這裡決定。房間命名、租戶檢查（#342），
 * 以及之後的渠道可見範圍（AUDIT RBAC-04）都集中在這個檔案。
 *
 * 不提供 conversation: 房間：沒有任何連線加入這個房間（#337 規劃第 8 節）。
 */

/** 全租戶推播：送到交易綁定租戶的 tenant: 房間 */
export type TenantPushName =
  | 'message.new'
  | 'conversation.updated'
  | 'conversation.created'
  | 'case.created'
  | 'case.updated'
  | 'case.deleted'
  | 'contact.merged'
  | 'contact.merge_reverted'
  | 'link.stats.updated';

/** 給單一客服人員的推播：送到 agent: 房間 */
export type AgentPushName = 'notification.new';

export function tenantPushRoom(tenantId: string): string {
  return `tenant:${tenantId}`;
}

/** agent: 房間沒有租戶前綴，這裡無法檢查 agentId 屬於哪個租戶；呼叫端只能用交易內查到的 ID */
export function agentPushRoom(agentId: string): string {
  return `agent:${agentId}`;
}
