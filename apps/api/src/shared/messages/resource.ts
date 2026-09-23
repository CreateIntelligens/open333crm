/**
 * 資源名稱的中文對照與「找不到」訊息產生器。
 *
 * 為何要集中：全專案 239 則英文 AppError 中，**137 則（57%）是「X not found」**，
 * 且散在各模組各寫各的（`Channel not found` 就有 16 處、7 種變體，
 * 連 `WEBCHAT` / `WebChat` 大小寫都不一致）。逐檔翻譯必然漂移——
 * 同一個「找不到渠道」在 A 模組叫「找不到渠道」、B 模組叫「查無此渠道」。
 *
 * 集中後：改一次全站一致，新模組直接沿用，不需再想措辭。
 */

/** 系統中會被「找不到」的資源，對應到使用者看得懂的名稱。 */
export const RESOURCE_LABELS = {
  agent: '成員',
  article: '知識庫文章',
  assignee: '指派對象',
  automationRule: '自動化規則',
  broadcast: '群發訊息',
  campaign: '行銷活動',
  case: '案件',
  caseTag: '案件標籤',
  category: '分類',
  channel: '渠道',
  channelIdentity: '渠道身分',
  channelTeamAssignment: '渠道團隊指派',
  contact: '聯絡人',
  contactTag: '聯絡人標籤',
  conversation: '對話',
  conversationTag: '對話標籤',
  coupon: '優惠券',
  fbChannel: 'Facebook 渠道',
  lineChannel: 'LINE 渠道',
  material: '素材',
  notification: '通知',
  passkey: 'Passkey',
  plan: '方案',
  platformUser: '平台帳號',
  portalActivity: '活動',
  primaryContact: '主要聯絡人',
  richMenu: '圖文選單',
  role: '角色',
  secondaryContact: '次要聯絡人',
  segment: '分眾名單',
  shortLink: '短連結',
  signup: '註冊申請',
  slaPolicy: 'SLA 政策',
  sourceTemplate: '來源版型',
  tag: '標籤',
  team: '團隊',
  template: '版型',
  tenant: '租戶',
  version: '版本',
  webchatChannel: '網頁聊天渠道',
  webhookSubscription: 'Webhook 訂閱',
} as const;

export type ResourceKey = keyof typeof RESOURCE_LABELS;

/**
 * 「找不到」訊息。
 *
 * 一律附上可能原因——只說「找不到 X」使用者不知道下一步該做什麼，
 * 而「可能已被刪除」至少說明了這不是系統故障、重新整理也沒用。
 *
 * ⚠️ 部分 404 是**刻意用來遮蔽權限**的（見 CM-173 渠道可見性）：
 * 資源存在但無權存取時回 404 而非 403，避免反向確認資源存在。
 * 那些情境同樣用這個訊息，**不要**改成「您沒有權限」。
 */
export function notFound(resource: ResourceKey): string {
  return `找不到此${RESOURCE_LABELS[resource]}，可能已被刪除或您沒有存取權限`;
}

/** 資源存在但已停用／封存，與「找不到」語意不同。 */
export function notAvailable(resource: ResourceKey): string {
  return `此${RESOURCE_LABELS[resource]}目前無法使用，可能已停用或已結束`;
}

/** 名稱等欄位重複。 */
export function alreadyExists(what: string): string {
  return `${what}已存在，請換一個`;
}
