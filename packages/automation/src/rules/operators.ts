export interface CustomOperatorDefinition {
  name: string;
  callback: (factValue: unknown, compareValue: unknown) => boolean;
}

/**
 * 文字比對用的比較值。舊版規則編輯器把「8888」「1」這類純數字存成數字（issue #418、AUDIT AUTO-06），
 * 文字欄位遇到數字比較值時當成文字比對，已存的規則不必重存就能觸發。其他型別回 undefined。
 */
function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/**
 * 與 json-rules-engine 的 `===` 相同，只多一種情況：欄位值是字串、比較值是有限數字時，
 * 把數字轉成字串再比。欄位值是數字時維持嚴格比對（數字欄位的行為不變）。
 */
function sameValue(factValue: unknown, compareValue: unknown): boolean {
  if (factValue === compareValue) return true;
  return (
    typeof factValue === 'string' &&
    typeof compareValue === 'number' &&
    Number.isFinite(compareValue) &&
    factValue === String(compareValue)
  );
}

/** json-rules-engine 內建 in 的行為（`b.indexOf(a) > -1`），清單元素改用 sameValue 比對 */
function isIn(factValue: unknown, list: unknown): boolean {
  if (Array.isArray(list)) return list.some((item) => sameValue(factValue, item));
  if (typeof list === 'string') return list.indexOf(String(factValue)) > -1;
  return false;
}

function arrayIncludes(factValue: unknown[], value: unknown): boolean {
  return factValue.some((item) => sameValue(item, value));
}

export const customOperators: readonly CustomOperatorDefinition[] = [
  // 覆寫 json-rules-engine 內建的 equal / notEqual / in / notIn：只補「文字欄位比對數字比較值」
  { name: 'equal', callback: (factValue, compareValue): boolean => sameValue(factValue, compareValue) },
  { name: 'notEqual', callback: (factValue, compareValue): boolean => !sameValue(factValue, compareValue) },
  { name: 'in', callback: (factValue, list): boolean => isIn(factValue, list) },
  { name: 'notIn', callback: (factValue, list): boolean => !isIn(factValue, list) },
  {
    name: 'containsAny',
    callback: (factValue, compareValue): boolean => {
      if (!Array.isArray(factValue) || !Array.isArray(compareValue)) return false;
      return compareValue.some((value) => arrayIncludes(factValue, value));
    },
  },
  {
    name: 'containsAll',
    callback: (factValue, compareValue): boolean => {
      if (!Array.isArray(factValue) || !Array.isArray(compareValue)) return false;
      return compareValue.every((value) => arrayIncludes(factValue, value));
    },
  },
  {
    name: 'matchesRegex',
    callback: (factValue, pattern): boolean => {
      const source = textOf(pattern);
      if (typeof factValue !== 'string' || source === undefined) return false;
      try {
        return new RegExp(source, 'i').test(factValue);
      } catch {
        return false;
      }
    },
  },
  {
    name: 'textContains',
    callback: (factValue, searchText): boolean => {
      const text = textOf(searchText);
      if (text === undefined) return false;
      return String(factValue ?? '').toLowerCase().includes(text.toLowerCase());
    },
  },
  {
    name: 'contains',
    callback: (factValue, searchText): boolean => {
      if (Array.isArray(factValue)) return arrayIncludes(factValue, searchText);
      const text = textOf(searchText);
      if (text === undefined) return false;
      return String(factValue ?? '').toLowerCase().includes(text.toLowerCase());
    },
  },
  {
    name: 'notContains',
    callback: (factValue, searchText): boolean => {
      if (Array.isArray(factValue)) return !arrayIncludes(factValue, searchText);
      const text = textOf(searchText);
      if (text === undefined) return true;
      return !String(factValue ?? '').toLowerCase().includes(text.toLowerCase());
    },
  },
  {
    name: 'startsWith',
    callback: (factValue, prefix): boolean => {
      const text = textOf(prefix);
      if (typeof factValue !== 'string' || text === undefined) return false;
      return factValue.toLowerCase().startsWith(text.toLowerCase());
    },
  },
  {
    name: 'exists',
    callback: (factValue): boolean => factValue !== undefined && factValue !== null && factValue !== '',
  },
  {
    name: 'notExists',
    callback: (factValue): boolean => factValue === undefined || factValue === null || factValue === '',
  },
];

export function registerCustomOperators(engine: {
  addOperator(name: string, cb: (factValue: unknown, compareValue: unknown) => boolean): void;
}): void {
  for (const op of customOperators) {
    engine.addOperator(op.name, op.callback);
  }
}
