import { UNSUPPORTED_AUTOMATION_ACTION_TYPES } from '@open333crm/automation';

/**
 * 既有規則的動作轉成編輯器格式（後端存 { type, params }，編輯器用 { type, payload }），
 * 並濾掉 workers 尚未支援的動作（AUDIT AUTO-01）：編輯器不提供、後端也會拒絕存檔，
 * 留在表單只會讓儲存失敗。編輯頁會另外提示哪些動作被移除。
 */
export function toEditorActions(actions: unknown): Array<{ type: string; payload: Record<string, unknown> }> {
  if (!Array.isArray(actions)) return [];
  return actions.flatMap((raw) => {
    const a = raw as { type?: unknown; payload?: Record<string, unknown>; params?: Record<string, unknown> } | null;
    if (!a || typeof a.type !== 'string' || UNSUPPORTED_AUTOMATION_ACTION_TYPES.has(a.type)) return [];
    return [{ type: a.type, payload: a.payload || a.params || {} }];
  });
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
