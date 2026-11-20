/**
 * 後台助理的導覽目錄（規格 dashboard-guide-assistant「導覽目錄的安全規則」）。
 *
 * API 以操作者的有效權限過濾這份目錄，再交給 LLM 選擇；前端依步驟切換頁面、點開入口、標示欄位。
 * 每個 `target` 對應頁面元素上的 `data-guide` 屬性。
 *
 * 安全規則（tests/unit/guide/guide-catalog.test.ts 檢查）：
 * - `click` 步驟的 `target` 以 `.open` 結尾。只有打開對話框、打開新頁或切換分頁的元素使用以 `.open` 結尾的值。
 * - 最後一個步驟是 `highlight`：助理不替員工送出或儲存資料。
 */
export type GuideAction = 'click' | 'highlight';

export interface GuideStep {
  /** 頁面元素的 `data-guide` 值 */
  target: string;
  action: GuideAction;
  /** 聚光框旁邊顯示的說明 */
  note: string;
}

export interface GuideDefinition {
  id: string;
  title: string;
  /** 功能頁的路徑，以 `/dashboard/` 開頭 */
  route: string;
  /** 執行導覽的功能需要的權限碼 */
  requiredPermission: string;
  steps: GuideStep[];
}

export const GUIDE_CATALOG: readonly GuideDefinition[] = [
  {
    id: 'keyword-reply.create',
    title: '新增關鍵字自動回覆',
    route: '/dashboard/line/keyword-replies',
    requiredPermission: 'automation.manage',
    steps: [
      { target: 'keyword-reply.open', action: 'click', note: '點「建立關鍵字回覆」' },
      { target: 'keyword-reply.keyword', action: 'highlight', note: '在這裡輸入關鍵字，再選擇要回覆的素材' },
    ],
  },
  {
    id: 'agent.create',
    title: '新增客服人員',
    route: '/dashboard/settings/agents',
    requiredPermission: 'agent.manage',
    steps: [
      { target: 'agent.open', action: 'click', note: '點「新增人員」' },
      { target: 'agent.name', action: 'highlight', note: '填入姓名與 Email，再選擇角色' },
    ],
  },
  {
    id: 'tag.create',
    title: '新增標籤',
    route: '/dashboard/settings/tags',
    requiredPermission: 'tag.manage',
    steps: [
      { target: 'tag.open', action: 'click', note: '點「新增標籤」' },
      { target: 'tag.name', action: 'highlight', note: '在這裡輸入標籤名稱' },
    ],
  },
  {
    id: 'channel.create',
    title: '串接渠道（LINE、Facebook、Instagram、WebChat）',
    route: '/dashboard/settings/channels',
    requiredPermission: 'channel.create',
    steps: [
      { target: 'channel.open', action: 'click', note: '點「新增渠道」' },
      { target: 'channel.type', action: 'highlight', note: '先選擇渠道類型，再填入下方的金鑰欄位' },
    ],
  },
  {
    id: 'broadcast.create',
    title: '建立群發廣播',
    route: '/dashboard/marketing/broadcasts',
    requiredPermission: 'marketing.manage',
    steps: [
      { target: 'marketing.open', action: 'click', note: '點右上角的建立按鈕' },
      { target: 'broadcast.name', action: 'highlight', note: '填入廣播名稱，再選擇渠道、受眾與內容' },
    ],
  },
  {
    id: 'segment.create',
    title: '建立受眾分群',
    route: '/dashboard/marketing/segments',
    requiredPermission: 'marketing.manage',
    steps: [
      { target: 'marketing.open', action: 'click', note: '點右上角的建立按鈕' },
      { target: 'segment.name', action: 'highlight', note: '填入分群名稱，再設定篩選條件' },
    ],
  },
  {
    id: 'knowledge.import',
    title: '匯入知識庫文章',
    route: '/dashboard/knowledge/articles',
    requiredPermission: 'knowledge.manage',
    steps: [
      { target: 'knowledge-import.open', action: 'click', note: '點「匯入文章」' },
      { target: 'knowledge-import.file', action: 'highlight', note: '選擇 JSON、CSV 或 Excel 檔案' },
    ],
  },
  {
    id: 'coupon.create',
    title: '建立優惠券',
    route: '/dashboard/marketing/coupons',
    requiredPermission: 'coupon.manage',
    steps: [
      { target: 'coupon.open', action: 'click', note: '點「建立優惠券」' },
      { target: 'coupon.name', action: 'highlight', note: '填入優惠券名稱，再設定折扣與領取方式' },
    ],
  },
  {
    id: 'plan.token-topup',
    title: '加購 AI token',
    route: '/dashboard/plan',
    requiredPermission: 'settings.manage',
    steps: [
      { target: 'plan-topup.open', action: 'click', note: '點「加購 Token」' },
      { target: 'plan-topup.amount', action: 'highlight', note: '選擇加購額度，再送出申請' },
    ],
  },
  {
    id: 'sla.create',
    title: '新增 SLA 政策',
    route: '/dashboard/settings/sla',
    requiredPermission: 'sla.manage',
    steps: [
      { target: 'sla.open', action: 'click', note: '點「建立 SLA 政策」' },
      { target: 'sla.name', action: 'highlight', note: '填入政策名稱，再設定回應與解決時限' },
    ],
  },
  {
    id: 'office-hours.edit',
    title: '設定營業時間',
    route: '/dashboard/settings/office-hours',
    requiredPermission: 'settings.manage',
    steps: [
      { target: 'office-hours.enabled', action: 'highlight', note: '開啟營業時間後，下方會出現每週排程' },
    ],
  },
  {
    id: 'chat-prompt.edit',
    title: '設定 AI 回覆的 prompt',
    route: '/dashboard/knowledge/chat-prompt',
    requiredPermission: 'settings.manage',
    steps: [
      { target: 'chat-prompt.system', action: 'highlight', note: '在這裡編輯 AI 客服回覆的 System Prompt' },
    ],
  },
];

/** 操作者有權限執行的導覽（規格「導覽只從操作者有權限的導覽中選」） */
export function guidesForPermissions(permissions: ReadonlySet<string>): GuideDefinition[] {
  return GUIDE_CATALOG.filter((g) => permissions.has(g.requiredPermission));
}
