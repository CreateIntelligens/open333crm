/**
 * json-rules-engine 條件樹的共用判斷。規則摘要與試跑表單都要走訪條件樹，
 * 寫在一處，之後支援 not 或 condition 參照時兩邊才會一致。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** all / any 群組：回傳組合方式與子節點；不是群組時回 null */
export function conditionGroup(node: unknown): { kind: 'all' | 'any'; children: unknown[] } | null {
  if (!isRecord(node) || !('all' in node || 'any' in node)) return null;
  const kind = 'all' in node ? 'all' : 'any';
  return { kind, children: Array.isArray(node[kind]) ? (node[kind] as unknown[]) : [] };
}

/** 單一條件（有 fact 的節點）；其他節點（not、condition 參照等）回 null */
export function conditionLeaf(node: unknown): { fact: string; operator: string; value: unknown } | null {
  if (!isRecord(node) || typeof node.fact !== 'string') return null;
  return { fact: node.fact, operator: String(node.operator ?? ''), value: node.value };
}

/** 依畫面順序列出條件樹裡的所有單一條件 */
export function conditionLeaves(node: unknown): Array<{ fact: string; operator: string; value: unknown }> {
  const group = conditionGroup(node);
  if (group) return group.children.flatMap(conditionLeaves);
  const leaf = conditionLeaf(node);
  return leaf ? [leaf] : [];
}
