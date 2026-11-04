import type { RuleGroupType, RuleType } from 'react-querybuilder';
import { AUTOMATION_FACT_MAP } from '@open333crm/automation';

/**
 * 依欄位在自動化契約的型別轉換條件值（issue #418、AUDIT AUTO-06）：
 * - 數字欄位（例如開啟案件數）：數字字串轉成數字
 * - 是／否欄位：「true」「false」轉成布林
 * - 其他欄位（訊息內容、聯絡人名稱、標籤、時間，以及契約沒有定義的欄位）一律保留字串，
 *   否則「訊息內容 包含 8888」會存成數字，文字比對永遠不成立
 */
function parseValue(fact: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const type = AUTOMATION_FACT_MAP.get(fact)?.type;
  if (type === 'number') {
    const num = Number(value);
    if (!Number.isNaN(num) && value.trim() !== '') return num;
    return value;
  }
  if (type === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return value;
}

const qbToEngineOperator: Record<string, string> = {
  '=': 'equal',
  '!=': 'notEqual',
  '<': 'lessThan',
  '<=': 'lessThanInclusive',
  '>': 'greaterThan',
  '>=': 'greaterThanInclusive',
};

const engineToQbOperator: Record<string, string> = {
  equal: 'equal',
  notEqual: 'notEqual',
  lessThan: 'lessThan',
  lessThanInclusive: 'lessThanInclusive',
  greaterThan: 'greaterThan',
  greaterThanInclusive: 'greaterThanInclusive',
};

/**
 * Convert a single json-rules-engine condition object back into either
 * a react-querybuilder RuleType or a nested RuleGroupType.
 */
function convertRule(
  item: Record<string, unknown>
): RuleType | RuleGroupType {
  if ('all' in item || 'any' in item) {
    return engineToQb(item);
  }
  return {
    field: item.fact as string,
    operator: engineToQbOperator[item.operator as string] ?? (item.operator as string),
    value: String(item.value ?? ''),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert react-querybuilder output to json-rules-engine condition shape.
 *
 * react-querybuilder produces:
 *   { combinator: 'and'|'or', rules: [{ field, operator, value } | nestedGroup] }
 *
 * json-rules-engine expects:
 *   { all: [...] }  (for AND)
 *   { any: [...] }  (for OR)
 *
 * Each leaf becomes: { fact, operator, value }
 */
export function qbToEngine(query: RuleGroupType): Record<string, unknown> {
  const key = query.combinator === 'and' ? 'all' : 'any';

  const conditions = query.rules.map((rule) => {
    // Nested group
    if ('combinator' in rule) {
      return qbToEngine(rule as RuleGroupType);
    }
    // Leaf rule
    const r = rule as RuleType;
    return {
      fact: r.field,
      operator: qbToEngineOperator[r.operator] ?? r.operator,
      value: parseValue(r.field, r.value),
    };
  });

  return { [key]: conditions };
}

/**
 * Convert json-rules-engine conditions back to react-querybuilder format.
 *
 * Handles both top-level { all: [...] } / { any: [...] } and nested groups.
 * Falls back to an empty AND group when the shape is unrecognised.
 */
export function engineToQb(
  conditions: Record<string, unknown>
): RuleGroupType {
  if ('all' in conditions) {
    return {
      combinator: 'and',
      rules: (conditions.all as Record<string, unknown>[]).map(convertRule),
    };
  }
  if ('any' in conditions) {
    return {
      combinator: 'or',
      rules: (conditions.any as Record<string, unknown>[]).map(convertRule),
    };
  }
  // Unrecognised shape -- return an empty group
  return { combinator: 'and', rules: [] };
}
