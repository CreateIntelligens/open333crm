/**
 * Socket 推播的種類與房間（主規格 tenant-transaction-context「推播的房間由系統決定」）。
 *
 * service 只說「什麼東西變了」，房間由這裡決定。房間命名、租戶檢查（#342），
 * 以及之後的渠道可見範圍（AUDIT RBAC-04）都集中在這個檔案。
 *
 * 不提供 conversation: 房間：沒有任何連線加入這個房間（#337 規劃第 8 節）。
 * 舊的 agent:<agentId> 房間沒有租戶 ID，新寫法不推到那裡。
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
  | 'link.stats.updated'
  /** 券發出、顧客開啟、核銷：收件匣「已發優惠券」重新載入（add-coupon-system design D23） */
  | 'coupon.instance.updated';

/** 給單一客服人員的推播：送到帶租戶 ID 的成員房間 */
export type AgentPushName = 'notification.new';

export function tenantPushRoom(tenantId: string): string {
  return `tenant:${tenantId}`;
}

/**
 * 成員連線時，伺服器依 token 的身分加入這個房間（socket-room-handlers.ts）。
 * 房間帶租戶 ID，所以 agentId 屬於別的租戶時，推播也只會到本租戶的房間，沒有連線收到。
 */
export function agentPushRoom(tenantId: string, agentId: string): string {
  return `tenant:${tenantId}:agent:${agentId}`;
}
