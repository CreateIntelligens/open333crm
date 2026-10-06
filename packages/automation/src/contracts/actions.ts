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
 * 已於 2026-10-05 從契約拿掉的動作與中文名稱（AUDIT AUTO-01，issue #197）。
 * workers 從未實作；機器人在負責的對話裡本來就會用知識庫與 AI 回覆，規則再觸發一次可能讓客人收到兩則回覆。
 * 不在 AUTOMATION_ACTION_DEFINITIONS 裡，所以編輯器不提供、存檔時拒絕，含它們的既有規則 workers 整條略過；
 * 既有規則中的這些動作由 migration 20261005100000_remove_retired_automation_actions 移除。
 * 保留中文名稱，讓驗證訊息與畫面不必顯示代碼。
 */
export const RETIRED_AUTOMATION_ACTIONS: ReadonlyMap<string, string> = new Map([
  ['assign_bot', '指派機器人'],
  ['kb_auto_reply', 'KB 知識庫回覆'],
  ['llm_reply', 'LLM 智能回覆'],
]);
