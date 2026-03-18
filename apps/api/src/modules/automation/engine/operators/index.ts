/**
 * Custom operators for json-rules-engine.
 *
 * These extend the built-in operator set (equal, notEqual, greaterThan, etc.)
 * with array and text matching capabilities needed by automation rules.
 */

export interface CustomOperatorDefinition {
  name: string;
  callback: (factValue: any, compareValue: any) => boolean;
}

export const customOperators: CustomOperatorDefinition[] = [
  {
    /**
     * containsAny – returns true if the factValue array contains
     * at least one element from compareValue.
     *
     * Example: contact.tags containsAny ['VIP', '客訴']
     */
    name: 'containsAny',
    callback: (factValue: string[], compareValue: string[]): boolean => {
      if (!Array.isArray(factValue) || !Array.isArray(compareValue)) return false;
      return compareValue.some((v) => factValue.includes(v));
    },
  },
  {
    /**
     * containsAll – returns true if the factValue array contains
     * ALL elements from compareValue.
     *
     * Example: contact.tags containsAll ['VIP', '保固中']
     */
    name: 'containsAll',
    callback: (factValue: string[], compareValue: string[]): boolean => {
      if (!Array.isArray(factValue) || !Array.isArray(compareValue)) return false;
      return compareValue.every((v) => factValue.includes(v));
    },
  },
  {
    /**
     * matchesRegex – tests factValue against a regex pattern (case-insensitive).
     *
     * Example: message.text matchesRegex '故障|壞掉|不會動'
     */
    name: 'matchesRegex',
    callback: (factValue: string, pattern: string): boolean => {
      if (typeof factValue !== 'string' || typeof pattern !== 'string') return false;
      try {
        return new RegExp(pattern, 'i').test(factValue);
      } catch {
        return false;
      }
    },
  },
  {
    /**
     * textContains – case-insensitive substring search.
     *
     * Example: message.text textContains '故障'
     */
    name: 'textContains',
    callback: (factValue: string, searchText: string): boolean => {
      if (typeof searchText !== 'string') return false;
      return (factValue || '').toLowerCase().includes(searchText.toLowerCase());
    },
  },
  {
    /**
     * contains – alias for textContains, used by seed data.
     *
     * The seed automation rules use `operator: 'contains'`, so we register
     * this as a convenience alias.
     */
    name: 'contains',
    callback: (factValue: string, searchText: string): boolean => {
      if (typeof searchText !== 'string') return false;
      return (factValue || '').toLowerCase().includes(searchText.toLowerCase());
    },
  },
  {
    /**
     * notContains – returns true if factValue does NOT contain searchText.
     */
    name: 'notContains',
    callback: (factValue: string, searchText: string): boolean => {
      if (typeof searchText !== 'string') return true;
      return !(factValue || '').toLowerCase().includes(searchText.toLowerCase());
    },
  },
  {
    /**
     * startsWith – returns true if factValue starts with the given prefix.
     */
    name: 'startsWith',
    callback: (factValue: string, prefix: string): boolean => {
      if (typeof factValue !== 'string' || typeof prefix !== 'string') return false;
      return factValue.toLowerCase().startsWith(prefix.toLowerCase());
    },
  },
];
