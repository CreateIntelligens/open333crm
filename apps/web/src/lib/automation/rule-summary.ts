import {
  AUTOMATION_ACTION_MAP,
  AUTOMATION_FACT_MAP,
  AUTOMATION_OPERATOR_MAP,
  type AutomationOperator,
} from '@open333crm/automation';
import { droppedActionLabel, ruleEventName } from './rule-actions';
import { ruleEventLabel } from './rule-list';
import { conditionGroup, conditionLeaf, isRecord } from './condition-tree';

/** 摘要裡的文字參數最多顯示幾個字，超過以「…」截斷 */
const MAX_TEXT = 18;

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

/** 條件的比較值：選項用中文名稱，數字直接寫，文字加「」 */
function formatValue(fact: string, value: unknown): string {
  const options = AUTOMATION_FACT_MAP.get(fact)?.values;
  const optionLabel = (v: unknown) => options?.find((o) => String(o.value) === String(v))?.label;
  if (Array.isArray(value)) return value.map((v) => optionLabel(v) ?? `「${clip(String(v))}」`).join('、');
  const label = optionLabel(value);
  if (label) return label;
  if (typeof value === 'number') return ` ${value}`;
  if (typeof value === 'boolean') return value ? '是' : '否';
  return `「${clip(String(value ?? ''))}」`;
}

function summarizeLeaf(node: { fact: string; operator: string; value: unknown }): string {
  const { fact, operator } = node;
  const factLabel = AUTOMATION_FACT_MAP.get(fact)?.label ?? fact;
  const operatorDef = AUTOMATION_OPERATOR_MAP.get(operator as AutomationOperator);
  const operatorLabel = operatorDef?.label ?? operator;
  if (operatorDef && !operatorDef.requiresValue) return `${factLabel}${operatorLabel}`;
  return `${factLabel}${operatorLabel}${formatValue(fact, node.value)}`;
}

/** 認不得的節點（not、condition 參照等）：不能丟掉，否則摘要看起來像沒有條件 */
const UNKNOWN_CONDITION = '（無法顯示的條件）';

function summarizeNode(node: unknown, nested: boolean): string {
  const group = conditionGroup(node);
  if (group) {
    const parts = group.children.map((child) => summarizeNode(child, true)).filter(Boolean);
    const joined = parts.join(group.kind === 'all' ? '，而且' : '，或');
    return nested && parts.length > 1 ? `（${joined}）` : joined;
  }
  const leaf = conditionLeaf(node);
  if (leaf) return summarizeLeaf(leaf);
  // 空物件代表沒有條件；其他形狀是認不得的條件
  return isRecord(node) && Object.keys(node).length === 0 ? '' : UNKNOWN_CONDITION;
}

/** 條件樹的中文描述；沒有條件時回空字串 */
export function summarizeConditions(conditions: unknown): string {
  if (conditions === undefined || conditions === null) return '';
  return summarizeNode(conditions, false);
}

/** 動作的中文描述：名稱加上主要的文字參數，例如 建立工單「客戶諮詢」 */
export function summarizeAction(action: unknown): string {
  if (!isRecord(action) || typeof action.type !== 'string') return '格式錯誤的動作';
  const def = AUTOMATION_ACTION_MAP.get(action.type);
  if (!def) return droppedActionLabel(action.type);
  const params = (isRecord(action.params) ? action.params : isRecord(action.payload) ? action.payload : {}) as Record<string, unknown>;
  // 參數是 ID（素材、客服）時不顯示：管理員看不懂 UUID
  const main = (def.params ?? []).find(
    (p) => (p.type === 'string' || p.type === 'textarea') && !/Id$/.test(p.key) && typeof params[p.key] === 'string' && params[p.key],
  );
  return main ? `${def.label}「${clip(String(params[main.key]))}」` : def.label;
}

/** 一句話描述規則：當<事件>時，如果<條件>，就<動作> */
export function summarizeRule(rule: {
  trigger?: { type?: string; keywords?: unknown; match_mode?: unknown } | null;
  eventType?: string;
  conditions?: unknown;
  actions?: unknown;
}): string {
  const conditions = summarizeConditions(rule.conditions);
  const actions = Array.isArray(rule.actions) ? rule.actions.map(summarizeAction) : [];
  const then = actions.length > 0 ? `就${actions.join('、')}` : '不做任何事';
  const when = `當${summarizeTrigger(rule)}時`;
  return conditions ? `${when}，如果${conditions}，${then}` : `${when}，${then}`;
}

/**
 * 觸發時機。關鍵字規則的條件通常是空的，要寫出關鍵字，否則每條關鍵字規則的摘要都一樣。
 */
function summarizeTrigger(rule: {
  trigger?: { type?: string; keywords?: unknown; match_mode?: unknown } | null;
  eventType?: string;
}): string {
  const keywords = Array.isArray(rule.trigger?.keywords)
    ? rule.trigger!.keywords.filter((k): k is string => typeof k === 'string' && k.length > 0)
    : [];
  if (ruleEventName(rule) === 'keyword.matched' && keywords.length > 0) {
    const quoted = keywords.map((k) => `「${clip(k)}」`);
    return rule.trigger?.match_mode === 'all' ? `訊息同時含有${quoted.join('和')}` : `訊息含有${quoted.join('或')}`;
  }
  return ruleEventLabel(rule);
}
