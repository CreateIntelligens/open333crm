/**
 * 聚類工具：字串相似度（fallback）+ cosine（有 embedding 時）+ 貪婪聚類。
 *
 * 效能重點：巨型組（如「送修流程/GENERIC」有 2700+ 則）若逐則跟每個既有 cluster
 * 代表做完整 cosine，會退化成 O(n²)×1024 維 → 數十億次浮點，單執行緒 JS 卡死。
 * 對策：
 *   1. 向量預先單位化（normalize），cosine 退化成純點積，省掉每次兩個開方。
 *   2. greedyCluster 限制「最多比對最近 maxReps 個 cluster 代表」，把 O(n·k) 壓成
 *      O(n·maxReps)。代價是可能少數該併的沒併（多產幾個近似 cluster），可接受。
 */

/** 取字串的 character bigram 集合（中文用單字 bigram）。 */
function bigrams(s: string): Set<string> {
  const clean = s.replace(/\s+/g, '');
  const out = new Set<string>();
  for (let i = 0; i < clean.length - 1; i++) out.add(clean.slice(i, i + 2));
  if (clean.length === 1) out.add(clean);
  return out;
}

/** Jaccard 相似度（0~1），無 embedding 時的 fallback。 */
export function jaccardSimilarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/** 把向量單位化（L2 normalize）；回傳 Float32Array 加速點積。 */
export function normalizeVector(v: number[]): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/** 兩個「已單位化」向量的 cosine = 點積。 */
function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** cosine 相似度（未正規化向量用；一般聚類請走 normalizeVector + greedyCluster）。 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return d / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface ClusterItem<T> {
  item: T;
  text: string;
  /** 已「單位化」的向量（normalizeVector 的產物）；無 embedding 時為 undefined。 */
  vector?: Float32Array;
}

/**
 * 貪婪聚類：逐一比對每個項目與既有 cluster 代表，相似度 ≥ threshold 就併入。
 * 有 vector 走點積（向量須已單位化），否則走 Jaccard。
 *
 * @param maxReps 每個項目最多比對「最近的 maxReps 個 cluster 代表」（0 = 不限）。
 *               巨型組請設有限值（如 400）避免 O(n²) 卡死。
 */
export function greedyCluster<T>(
  items: ClusterItem<T>[],
  threshold: number,
  maxReps = 0,
): ClusterItem<T>[][] {
  const clusters: ClusterItem<T>[][] = [];
  for (const it of items) {
    let placed = false;
    // 從最近建立的 cluster 往回比（近期代表較可能相似），最多 maxReps 個。
    const start = maxReps > 0 ? Math.max(0, clusters.length - maxReps) : 0;
    for (let ci = clusters.length - 1; ci >= start; ci--) {
      const rep = clusters[ci][0];
      const sim =
        it.vector && rep.vector
          ? dot(it.vector, rep.vector)
          : jaccardSimilarity(it.text, rep.text);
      if (sim >= threshold) {
        clusters[ci].push(it);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([it]);
  }
  return clusters;
}
