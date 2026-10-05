import {
  AUTOMATION_ACTION_MAP,
  composeAutomationContract,
  UNSUPPORTED_AUTOMATION_ACTION_TYPES,
  validateAutomationRuleContract,
} from '@open333crm/automation';

type StoredAction = { type?: unknown; payload?: Record<string, unknown>; params?: Record<string, unknown> } | null;

export type DroppedAction = {
  type: string;
  label: string;
  /** true：workers 驗證失敗、整條規則略過；false：尚未支援的動作，workers 只略過這個動作 */
  skipsRule: boolean;
};

/**
 * 規則的觸發事件。後端以 trigger.type 為準、eventType 為後備（同 automation.service updateRule）；
 * 兩者都沒有時是預設的「收到訊息」。
 */
export function ruleEventName(rule: { trigger?: { type?: string } | null; eventType?: string }): string {
  return rule.trigger?.type || rule.eventType || 'message.received';
}

/**
 * 既有規則的動作分成兩份：
 * - actions：轉成編輯器格式（後端存 { type, params }，編輯器用 { type, payload }）
 * - dropped：這個觸發事件的契約沒有提供的動作，後端都會拒絕存檔，留在表單只會讓儲存失敗
 *
 * dropped 分兩類，編輯頁要分開說明：
 * - workers 尚未支援、但事件有提供的動作（AUDIT AUTO-01）：workers 只略過該動作
 * - 其餘（不適用於這個事件、契約從來沒有的舊動作如 auto_assign、格式錯誤）：workers 驗證失敗，整條規則略過
 */
export function splitRuleActions(
  actions: unknown,
  eventName: string,
): { actions: Array<{ type: string; payload: Record<string, unknown> }>; dropped: DroppedAction[] } {
  const result: { actions: Array<{ type: string; payload: Record<string, unknown> }>; dropped: DroppedAction[] } = {
    actions: [],
    dropped: [],
  };
  if (!Array.isArray(actions)) return result;

  // composer 預設已排除尚未支援的動作；含尚未支援的，才是 workers 執行時看到的動作
  const offered = new Set(composeAutomationContract(eventName)?.actions.map((a) => a.type));
  const workerAccepted = new Set(
    composeAutomationContract(eventName, { allowUnsupportedActions: true })?.actions.map((a) => a.type),
  );

  for (const raw of actions) {
    const a = raw as StoredAction;
    if (!a || typeof a.type !== 'string') {
      result.dropped.push({ type: '', label: '格式錯誤的動作', skipsRule: true });
    } else if (offered.has(a.type)) {
      result.actions.push({ type: a.type, payload: a.payload || a.params || {} });
    } else {
      result.dropped.push({
        type: a.type,
        label: AUTOMATION_ACTION_MAP.get(a.type)?.label ?? `未知動作（${a.type}）`,
        skipsRule: !(UNSUPPORTED_AUTOMATION_ACTION_TYPES.has(a.type) && workerAccepted.has(a.type)),
      });
    }
  }
  return result;
}

/**
 * workers 執行規則前用同樣的選項驗證契約，失敗就整條略過、只寫 log
 * （apps/workers/src/handlers/automation.handler.ts）。規則列表用這裡標示，管理員才看得到。
 */
export function findWorkerSkipErrors(rule: {
  trigger?: { type?: string } | null;
  eventType?: string;
  conditions?: unknown;
  actions?: unknown;
}): string[] {
  return validateAutomationRuleContract({
    eventName: ruleEventName(rule),
    conditions: rule.conditions,
    actions: rule.actions,
    options: { allowUnsupportedActions: true },
  }).errors;
}

/** 選填參數空值時的標籤；分類不指定時由系統依顧客訊息自動分類 */
const EMPTY_OPTION_LABELS: Record<string, string> = { category: '不指定（由 AI 分類）' };

/**
 * 下拉參數的選項。選填的參數在最前面加值為空的「不指定」：
 * 原本沒有這個選項，值為空時畫面會顯示第一個選項（例如分類顯示「產品諮詢」、優先級顯示「低」），
 * 實際卻存成空值，使用者看到的與存的不一致，選過之後也改不回「不指定」。
 */
export function selectOptionsForParam(param: {
  key: string;
  required?: boolean;
  values?: ReadonlyArray<{ value: string | number | boolean; label: string }>;
}): Array<{ value: string; label: string }> {
  const options = (param.values ?? []).map((o) => ({ value: String(o.value), label: o.label }));
  return param.required ? options : [{ value: '', label: EMPTY_OPTION_LABELS[param.key] ?? '不指定' }, ...options];
}
