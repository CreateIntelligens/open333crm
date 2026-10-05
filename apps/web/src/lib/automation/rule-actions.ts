import {
  AUTOMATION_ACTION_MAP,
  composeAutomationContract,
  RETIRED_AUTOMATION_ACTIONS,
  validateAutomationRuleContract,
} from '@open333crm/automation';

type StoredAction = { type?: unknown; payload?: Record<string, unknown>; params?: Record<string, unknown> } | null;

export type DroppedAction = {
  type: string;
  label: string;
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
 * - dropped：這個觸發事件的契約沒有提供的動作（不適用於這個事件、契約沒有的舊動作如 auto_assign
 *   或 2026-10-05 拿掉的 llm_reply、格式錯誤）。後端拒絕存檔，workers 驗證失敗、整條規則略過
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

  const offered = new Set(composeAutomationContract(eventName)?.actions.map((a) => a.type));

  for (const raw of actions) {
    const a = raw as StoredAction;
    if (!a || typeof a.type !== 'string') {
      result.dropped.push({ type: '', label: '格式錯誤的動作' });
    } else if (offered.has(a.type)) {
      result.actions.push({ type: a.type, payload: a.payload || a.params || {} });
    } else {
      result.dropped.push({
        type: a.type,
        label: droppedActionLabel(a.type),
      });
    }
  }
  return result;
}

/** 被移除動作的名稱：契約有的用中文名稱，已停用的標示（已停用），其他是未知動作 */
export function droppedActionLabel(type: string): string {
  const label = AUTOMATION_ACTION_MAP.get(type)?.label;
  if (label) return label;
  const retired = RETIRED_AUTOMATION_ACTIONS.get(type);
  return retired ? `${retired}（已停用）` : `未知動作（${type}）`;
}

/**
 * workers 執行規則前用同樣的方式驗證契約，失敗就整條略過、只寫 log
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

/**
 * 「指派客服」的下拉選項。原本要手動填 Agent UUID；改成從客服名單選人。
 * 規則存的客服已停用或不在名單時保留原值並標出，不讓欄位默默變成空白。
 */
export function agentOptions(
  agents: ReadonlyArray<{ id: string; name?: string | null; email?: string | null }>,
  currentId: string,
  /** 名單是否已載入；載入前不能判斷已指派的客服是否還在 */
  loaded = true,
): Array<{ value: string; label: string }> {
  const options = [
    { value: '', label: '請選擇客服' },
    ...agents.map((a) => ({
      value: a.id,
      label: a.name ? `${a.name}${a.email ? `（${a.email}）` : ''}` : a.email || a.id,
    })),
  ];
  if (currentId && !agents.some((a) => a.id === currentId)) {
    options.push({
      value: currentId,
      label: loaded ? `已停用或找不到的客服（${currentId.slice(0, 8)}）` : '載入客服名單中…',
    });
  }
  return options;
}
