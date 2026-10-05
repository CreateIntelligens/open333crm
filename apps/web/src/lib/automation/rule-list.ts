import { AUTOMATION_EVENT_MAP } from '@open333crm/automation';
import { ruleEventName } from './rule-actions';

export type RuleStatusFilter = 'all' | 'active' | 'inactive';

/** 規則觸發事件的中文名稱；契約沒有的事件沿用代碼 */
export function ruleEventLabel(rule: { trigger?: { type?: string } | null; eventType?: string }): string {
  const name = ruleEventName(rule);
  return AUTOMATION_EVENT_MAP.get(name)?.label ?? name;
}

/** 依名稱（不分大小寫）與啟用狀態篩選規則 */
export function filterRules<T extends { name: string; isActive: boolean }>(
  rules: T[],
  filter: { query: string; status: RuleStatusFilter },
): T[] {
  const query = filter.query.trim().toLowerCase();
  return rules.filter(
    (rule) =>
      (!query || rule.name.toLowerCase().includes(query)) &&
      (filter.status === 'all' || rule.isActive === (filter.status === 'active')),
  );
}
