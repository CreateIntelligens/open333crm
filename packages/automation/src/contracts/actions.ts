import type { AutomationActionDefinition, AutomationValueOption } from './types.js';

const casePriorityOptions = [
  { value: 'LOW', label: '低' },
  { value: 'MEDIUM', label: '中' },
  { value: 'HIGH', label: '高' },
  { value: 'URGENT', label: '緊急' },
] satisfies AutomationValueOption[];

// 與 @open333crm/shared 的 CASE_CATEGORIES 一致（本套件不依賴 shared；api 測試比對兩份清單）
const caseCategoryOptions = [
  '產品諮詢',
  '訂單問題',
  '退換貨',
  '帳號問題',
  '技術支援',
  '投訴建議',
  '付款問題',
  '物流配送',
  '其他',
].map((value) => ({ value, label: value })) satisfies AutomationValueOption[];

const caseStatusOptions = [
  { value: 'OPEN', label: '開啟' },
  { value: 'IN_PROGRESS', label: '處理中' },
  { value: 'ESCALATED', label: '已升級' },
  { value: 'RESOLVED', label: '已解決' },
  { value: 'CLOSED', label: '已關閉' },
] satisfies AutomationValueOption[];

export const AUTOMATION_ACTION_DEFINITIONS: readonly AutomationActionDefinition[] = [
  {
    type: 'send_message',
    label: '傳送訊息',
    requires: ['contact', 'conversation'],
    mutates: ['conversation', 'message'],
    params: [
      {
        key: 'text',
        label: '訊息內容',
        type: 'textarea',
        required: true,
        placeholder: '輸入要發送的訊息...',
      },
    ],
  },
  {
    type: 'llm_reply',
    label: 'LLM 智能回覆',
    requires: ['contact', 'conversation', 'message'],
    mutates: ['conversation', 'message'],
    params: [
      {
        key: 'systemPrompt',
        label: '系統提示',
        type: 'textarea',
        placeholder: '自訂 LLM 系統提示，留空使用預設...',
      },
    ],
  },
  {
    type: 'kb_auto_reply',
    label: 'KB 知識庫回覆',
    requires: ['contact', 'conversation', 'message'],
    mutates: ['conversation', 'message'],
  },
  {
    type: 'send_material',
    label: '傳送素材',
    requires: ['contact', 'conversation'],
    mutates: ['conversation', 'message'],
    params: [
      {
        key: 'materialId',
        label: '素材 ID',
        type: 'string',
        required: true,
        placeholder: '從素材庫選擇要送出的素材',
      },
    ],
  },
  {
    type: 'create_case',
    label: '建立工單',
    // 工單的渠道取自觸發的對話；工單、SLA、聯絡人事件沒有對話，也避免「工單建立 → 建立工單」的迴圈
    requires: ['contact', 'conversation'],
    mutates: ['case'],
    params: [
      { key: 'title', label: '工單標題', type: 'string', required: true },
      {
        key: 'priority',
        label: '優先級',
        type: 'select',
        values: casePriorityOptions,
      },
      { key: 'category', label: '分類', type: 'select', values: caseCategoryOptions },
    ],
  },
  {
    type: 'update_case_status',
    label: '更新工單狀態',
    requires: ['case'],
    mutates: ['case'],
    params: [
      {
        key: 'status',
        label: '目標狀態',
        type: 'select',
        required: true,
        values: caseStatusOptions,
      },
    ],
  },
  {
    type: 'escalate_case',
    label: '升級工單',
    requires: ['case'],
    mutates: ['case'],
    params: [
      { key: 'reason', label: '升級原因', type: 'string' },
      {
        key: 'newPriority',
        label: '新優先級',
        type: 'select',
        values: casePriorityOptions,
      },
    ],
  },
  {
    type: 'set_case_priority',
    label: '設定工單優先級',
    requires: ['case'],
    mutates: ['case'],
    params: [
      {
        key: 'priority',
        label: '優先級',
        type: 'select',
        required: true,
        values: casePriorityOptions,
      },
    ],
  },
  {
    type: 'add_tag',
    label: '新增標籤',
    requires: ['contact'],
    mutates: ['contact'],
    params: [{ key: 'tagName', label: '標籤名稱', type: 'string', required: true }],
  },
  {
    type: 'remove_tag',
    label: '移除標籤',
    requires: ['contact'],
    mutates: ['contact'],
    params: [{ key: 'tagName', label: '標籤名稱', type: 'string', required: true }],
  },
  {
    type: 'assign_agent',
    label: '指派客服',
    requires: ['case'],
    mutates: ['case', 'agent'],
    params: [{ key: 'agentId', label: '指派給', type: 'agent', required: true }],
  },
  {
    type: 'assign_bot',
    label: '指派機器人',
    requires: ['conversation'],
    mutates: ['conversation'],
  },
  {
    type: 'notify',
    label: '傳送通知',
    requires: ['tenant'],
    mutates: [],
    params: [{ key: 'message', label: '通知訊息', type: 'string', required: true }],
  },
  {
    type: 'notify_supervisor',
    label: '通知主管',
    requires: ['tenant'],
    mutates: [],
    params: [{ key: 'message', label: '通知訊息', type: 'string', required: true }],
  },
] as const;

export const AUTOMATION_ACTION_MAP: ReadonlyMap<string, AutomationActionDefinition> =
  new Map(AUTOMATION_ACTION_DEFINITIONS.map((action) => [action.type, action]));

/**
 * workers 尚未實作的動作（AUDIT AUTO-01）。
 * 2026-05 自動化執行搬到 apps/workers 時，這幾種動作沒有搬過去：規則可以存檔、條件也會命中，
 * 但 workers 只記一行 log 就略過，租戶以為規則有效。在 workers 補上實作之前：
 *   - 規則編輯器不提供（composer 預設排除）
 *   - 存檔時拒絕（validateAutomationRuleContract）
 *   - 既有規則在 workers 照常執行其他動作，只跳過這幾個（allowUnsupportedActions）
 * workers 補上實作後，從這裡移除即可（create_case 已於 2026-10-02 補上）。
 */
export const UNSUPPORTED_AUTOMATION_ACTION_TYPES: ReadonlySet<string> = new Set([
  'remove_tag',
  'assign_bot',
  'kb_auto_reply',
  'llm_reply',
]);

/** 規則動作中 workers 尚未支援的項目（給規則列表、編輯頁提示用） */
export function findUnsupportedAutomationActions(actions: unknown): Array<{ type: string; label: string }> {
  if (!Array.isArray(actions)) return [];
  return actions.flatMap((action) => {
    const type = (action as { type?: unknown } | null)?.type;
    if (typeof type !== 'string' || !UNSUPPORTED_AUTOMATION_ACTION_TYPES.has(type)) return [];
    return [{ type, label: AUTOMATION_ACTION_MAP.get(type)?.label ?? type }];
  });
}
