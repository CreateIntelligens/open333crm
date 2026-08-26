/**
 * 權限點 Registry（Permission Registry）
 *
 * 全系統唯一事實來源：所有可授予的操作能力都在此宣告。
 * 對應規格書 SPEC.md §4（權限點清單）與 §3（命名/關聯機制）。
 *
 * 命名規範：`resource.action`，resource 用 lowercase kebab-case，
 * action 用 CRUD 動詞（view/create/update/delete）或明確能力動詞（assign/export/send/manage 等）。
 *
 * 關聯機制：
 * - dependsOn：同功能前置（進 DB、UI 顯示、勾選連動）——如 inbox.reply 需先有 inbox.view
 * - implies：跨模組隱含（不進 DB、解析時自動補、UI 唯讀說明）——如 case.assign 用到 agent.view
 * - group：功能分群（UI 分區）
 * - feature：所屬平台 feature module（供平台 entitlement 天花板對應，見 ARCH-PLATFORM-LAYER §0.1）
 */

export interface PermissionDef {
  /** 權限碼，格式 resource.action，全域唯一 */
  code: string;
  /** UI 分群（使用者語言） */
  group: string;
  /** 所屬平台 feature module（每個權限點恰好歸屬一個 feature） */
  feature: string;
  /** 顯示名稱 */
  label: string;
  /** 說明 */
  description: string;
  /** 同功能前置權限（進 DB、勾選連動） */
  dependsOn?: string[];
  /** 跨模組隱含權限（不進 DB、解析時補） */
  implies?: string[];
  /** admin system role 鎖定核心權限，不可移除 */
  adminLock?: boolean;
  /** 防自鎖：不可從自身當前角色移除 */
  selfLock?: boolean;
}

export const PERMISSIONS: readonly PermissionDef[] = [
  // ── 客服作業（feature: inbox）──
  { code: 'inbox.view', group: '客服作業', feature: 'inbox', label: '檢視對話', description: '對話列表與訊息內容' },
  { code: 'inbox.reply', group: '客服作業', feature: 'inbox', label: '回覆對話', description: '送出訊息、圖片、影片', dependsOn: ['inbox.view'] },
  { code: 'inbox.manage', group: '客服作業', feature: 'inbox', label: '管理對話', description: '改狀態、關閉、轉接、加移標籤', dependsOn: ['inbox.view'], implies: ['tag.view'] },

  // ── 案件（feature: inbox）──
  { code: 'case.view', group: '案件', feature: 'inbox', label: '檢視案件', description: '列表、詳情、事件、統計' },
  { code: 'case.create', group: '案件', feature: 'inbox', label: '建立案件', description: '由對話開案或直接建案', dependsOn: ['case.view'] },
  { code: 'case.update', group: '案件', feature: 'inbox', label: '編輯案件', description: '改欄位、註記、標籤、resolve/close/reopen', dependsOn: ['case.view'] },
  { code: 'case.assign', group: '案件', feature: 'inbox', label: '指派案件', description: '派工／改派給成員', dependsOn: ['case.view'], implies: ['agent.view'] },
  { code: 'case.escalate', group: '案件', feature: 'inbox', label: '升級案件', description: '升級案件', dependsOn: ['case.view'] },
  { code: 'case.delete', group: '案件', feature: 'inbox', label: '刪除案件', description: '永久刪除案件', dependsOn: ['case.view'] },

  // ── 聯絡人（feature: inbox）──
  { code: 'contact.view', group: '聯絡人', feature: 'inbox', label: '檢視聯絡人', description: '列表、詳情、timeline' },
  { code: 'contact.update', group: '聯絡人', feature: 'inbox', label: '編輯聯絡人', description: '改欄位、加移標籤', dependsOn: ['contact.view'], implies: ['tag.view'] },
  { code: 'contact.merge', group: '聯絡人', feature: 'inbox', label: '合併聯絡人', description: '合併重複聯絡人', dependsOn: ['contact.view'] },

  // ── 標籤（feature: inbox）──
  { code: 'tag.view', group: '標籤', feature: 'inbox', label: '檢視標籤', description: '標籤列表' },
  { code: 'tag.manage', group: '標籤', feature: 'inbox', label: '管理標籤', description: '建立/編輯/刪除標籤', dependsOn: ['tag.view'] },

  // ── 知識庫（feature: knowledge）──
  { code: 'knowledge.view', group: '知識庫', feature: 'knowledge', label: '檢視知識庫', description: '列表、來源、分類、搜尋、feedback' },
  { code: 'knowledge.manage', group: '知識庫', feature: 'knowledge', label: '管理知識庫', description: '建/改/刪文章、publish/archive、import/upload/embed', dependsOn: ['knowledge.view'] },
  { code: 'knowledge.admin', group: '知識庫', feature: 'knowledge', label: '知識庫進階', description: 'partner-ingest、models/refresh、feedback resolve', dependsOn: ['knowledge.view'] },

  // ── 自動化（feature: automation）──
  { code: 'automation.view', group: '自動化', feature: 'automation', label: '檢視自動化', description: '規則列表、詳情、logs、test' },
  { code: 'automation.manage', group: '自動化', feature: 'automation', label: '管理自動化', description: '建/改/刪規則', dependsOn: ['automation.view'], implies: ['channel.view'] },
  { code: 'canvas.use', group: '自動化', feature: 'automation', label: '使用自動化畫布', description: 'canvas CRUD/activate/trigger' },
  { code: 'identity.review', group: '自動化', feature: 'automation', label: '審核識別建議', description: 'identity suggestions approve/reject', dependsOn: ['contact.view'] },

  // ── 渠道管理（feature: channels）──
  { code: 'channel.view', group: '渠道管理', feature: 'channels', label: '檢視渠道', description: '列表、詳情、status、embed-code' },
  { code: 'channel.create', group: '渠道管理', feature: 'channels', label: '新增渠道', description: '建立新的訊息渠道', dependsOn: ['channel.view'] },
  { code: 'channel.update', group: '渠道管理', feature: 'channels', label: '編輯渠道', description: '改設定、setup-webhook、verify', dependsOn: ['channel.view'] },
  { code: 'channel.delete', group: '渠道管理', feature: 'channels', label: '刪除渠道', description: '刪除渠道', dependsOn: ['channel.view'] },
  { code: 'richmenu.manage', group: '渠道管理', feature: 'channels', label: '管理圖文選單', description: 'LINE rich-menu CRUD/publish', dependsOn: ['channel.view'] },
  { code: 'quickreply.manage', group: '渠道管理', feature: 'channels', label: '管理快速回覆', description: 'quick-reply-preset 寫入' },

  // ── 行銷（feature: marketing）──
  { code: 'marketing.view', group: '行銷', feature: 'marketing', label: '檢視行銷', description: '名單、活動、群發、素材、模板' },
  { code: 'marketing.manage', group: '行銷', feature: 'marketing', label: '管理行銷', description: '建/改/刪 名單/活動/素材', dependsOn: ['marketing.view'], implies: ['contact.view'] },
  { code: 'marketing.broadcast', group: '行銷', feature: 'marketing', label: '執行群發', description: 'broadcast send/cancel', dependsOn: ['marketing.view'], implies: ['channel.view'] },

  // ── 分析報表（feature: analytics）──
  { code: 'analytics.view', group: '分析報表', feature: 'analytics', label: '檢視報表', description: 'overview、各維度報表' },
  { code: 'analytics.view.self', group: '分析報表', feature: 'analytics', label: '檢視個人數據', description: '只看自己的數據（/analytics/my）' },
  { code: 'analytics.export', group: '分析報表', feature: 'analytics', label: '匯出報表', description: 'POST /export', dependsOn: ['analytics.view'] },

  // ── 短連結（feature: inbox）──
  { code: 'shortlink.view', group: '短連結', feature: 'inbox', label: '檢視短連結', description: '列表、stats、clicks、qrcode' },
  { code: 'shortlink.manage', group: '短連結', feature: 'inbox', label: '管理短連結', description: '建/改/刪短連結', dependsOn: ['shortlink.view'] },

  // ── 粉絲活動（feature: portal）──
  { code: 'portal.view', group: '粉絲活動', feature: 'portal', label: '檢視粉絲活動', description: '活動、submissions、點數' },
  { code: 'portal.manage', group: '粉絲活動', feature: 'portal', label: '管理粉絲活動', description: '建/改/刪、publish/end、抽獎、點數調整', dependsOn: ['portal.view'] },

  // ── 系統設定（feature: core）──
  { code: 'settings.manage', group: '系統設定', feature: 'core', label: '系統設定', description: 'office-hours、tracking、embedding、chat、api-keys、cli-sessions' },
  { code: 'sla.manage', group: '系統設定', feature: 'core', label: 'SLA 政策', description: 'SLA CRUD' },
  { code: 'webhook.view', group: '系統設定', feature: 'core', label: '檢視 Webhook 訂閱', description: 'outbound webhook 列表/deliveries' },
  { code: 'webhook.manage', group: '系統設定', feature: 'core', label: '管理 Webhook 訂閱', description: '建/改/刪、test', dependsOn: ['webhook.view'] },

  // ── 人員與權限（feature: core）──
  { code: 'agent.view', group: '人員與權限', feature: 'core', label: '檢視成員', description: '成員列表' },
  { code: 'agent.manage', group: '人員與權限', feature: 'core', label: '管理成員', description: '建立/編輯成員', dependsOn: ['agent.view'], adminLock: true },
  { code: 'agent.role.assign', group: '人員與權限', feature: 'core', label: '指派角色', description: '指派角色給成員（受越權防護）', dependsOn: ['agent.view'], implies: ['role.view'] },
  { code: 'agent.password.reset', group: '人員與權限', feature: 'core', label: '重設他人密碼', description: '重設其他成員密碼', dependsOn: ['agent.view'] },
  { code: 'agent.delete', group: '人員與權限', feature: 'core', label: '刪除成員', description: '刪除成員帳號', dependsOn: ['agent.view'] },
  { code: 'role.view', group: '人員與權限', feature: 'core', label: '檢視角色權限', description: '開啟角色權限設定頁' },
  { code: 'role.manage', group: '人員與權限', feature: 'core', label: '管理角色權限', description: '角色 CRUD、RolePermission 指派', dependsOn: ['role.view'], adminLock: true, selfLock: true },
  { code: 'billing.view', group: '人員與權限', feature: 'core', label: '檢視方案與用量', description: '租戶站內方案/用量頁' },

  // ── 稽核與合規（feature: core）──
  { code: 'audit.view', group: '稽核與合規', feature: 'core', label: '檢視操作稽核', description: '租戶操作稽核日誌查詢' },
  { code: 'data.export', group: '稽核與合規', feature: 'core', label: '匯出租戶資料', description: 'GDPR 可攜權：匯出聯絡人/案件/對話等' },
  { code: 'data.erase', group: '稽核與合規', feature: 'core', label: '刪除聯絡人資料', description: 'GDPR 被遺忘權：匿名化或硬刪聯絡人', dependsOn: ['contact.view'] },
] as const;

/** 所有權限碼集合（快速查詢用） */
export const PERMISSION_CODES: ReadonlySet<string> = new Set(PERMISSIONS.map((p) => p.code));

/** code → PermissionDef 索引 */
export const PERMISSION_BY_CODE: ReadonlyMap<string, PermissionDef> = new Map(
  PERMISSIONS.map((p) => [p.code, p]),
);
