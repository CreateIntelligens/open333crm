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
