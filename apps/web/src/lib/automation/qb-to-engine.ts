import type { RuleGroupType, RuleType } from 'react-querybuilder';

/**
 * Parse a string value into its appropriate JS type.
 * - "true"/"false" become booleans
 * - Numeric strings become numbers
 * - Everything else stays a string
 */
function parseValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  const num = Number(value);
  if (!Number.isNaN(num) && value.trim() !== '') return num;
  return value;
}

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
    operator: item.operator as string,
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
      operator: r.operator,
      value: parseValue(r.value),
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
