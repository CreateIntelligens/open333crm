export interface CustomOperatorDefinition {
  name: string;
  callback: (factValue: unknown, compareValue: unknown) => boolean;
}

export const customOperators: readonly CustomOperatorDefinition[] = [
  {
    name: 'containsAny',
    callback: (factValue, compareValue): boolean => {
      if (!Array.isArray(factValue) || !Array.isArray(compareValue)) return false;
      return compareValue.some((value) => factValue.includes(value));
    },
  },
  {
    name: 'containsAll',
    callback: (factValue, compareValue): boolean => {
      if (!Array.isArray(factValue) || !Array.isArray(compareValue)) return false;
      return compareValue.every((value) => factValue.includes(value));
    },
  },
  {
    name: 'matchesRegex',
    callback: (factValue, pattern): boolean => {
      if (typeof factValue !== 'string' || typeof pattern !== 'string') return false;
      try {
        return new RegExp(pattern, 'i').test(factValue);
      } catch {
        return false;
      }
    },
  },
  {
    name: 'textContains',
    callback: (factValue, searchText): boolean => {
      if (typeof searchText !== 'string') return false;
      return String(factValue ?? '').toLowerCase().includes(searchText.toLowerCase());
    },
  },
  {
    name: 'contains',
    callback: (factValue, searchText): boolean => {
      if (Array.isArray(factValue)) return factValue.includes(searchText);
      if (typeof searchText !== 'string') return false;
      return String(factValue ?? '').toLowerCase().includes(searchText.toLowerCase());
    },
  },
  {
    name: 'notContains',
    callback: (factValue, searchText): boolean => {
      if (Array.isArray(factValue)) return !factValue.includes(searchText);
      if (typeof searchText !== 'string') return true;
      return !String(factValue ?? '').toLowerCase().includes(searchText.toLowerCase());
    },
  },
  {
    name: 'startsWith',
    callback: (factValue, prefix): boolean => {
      if (typeof factValue !== 'string' || typeof prefix !== 'string') return false;
      return factValue.toLowerCase().startsWith(prefix.toLowerCase());
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
