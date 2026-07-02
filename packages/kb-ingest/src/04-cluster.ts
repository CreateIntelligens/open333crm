/**
 * 階段 04 — 去重/聚合（幾百碎片 → 一篇好文章）
 *
 * Layer 1 硬分組：以 (category, 型號主鍵 or 'GENERIC') 分堆。
 * Layer 2 組內聚類：有 Ollama 用 embedding+cosine，否則 fallback 到字串 Jaccard。
 * Layer 3 聚合成篇：cluster 有多筆時用 Gemini 合併成一篇；單筆直接成篇。
 *   cluster 記 frequency（被問幾次），volatile/needsReview 取組內 OR。
 *
 * 產出 04-articles.jsonl + 供人工審核的 04-articles.csv。
 *
 * 執行：pnpm --filter @open333crm/kb-ingest cluster
 *   （--no-llm 跳過 Gemini 合併，單純用出現最多次的那筆當代表，供快速預覽）
 */
import { FILES } from './lib/config.js';
import { readJsonl, writeJsonl, writeCsv, appendJsonl } from './lib/jsonl.js';
import { greedyCluster, normalizeVector, type ClusterItem } from './lib/cluster.js';
import { ollamaEmbed, geminiGenerate, withRetry } from './lib/llm.js';
import { MERGE_SYSTEM_PROMPT } from './lib/prompts.js';
import { normalizeCategory, isSpecificLocation, isLowInfo } from './lib/guards.js';
import type { ExtractedQa, ArticleDraft } from './lib/types.js';

const CLUSTER_THRESHOLD_COSINE = 0.85;
const CLUSTER_THRESHOLD_JACCARD = 0.5;
/**
 * 只對「被問過 ≥ 此次數」的 cluster 花一次 Gemini 合併成篇（高價值主題）。
 * 其餘多筆 cluster 取信心最高的代表筆即可——避免上千次 Gemini 呼叫拖到數小時。
 */
const MERGE_MIN_FREQ = 3;

function parseArgs(): { noLlm: boolean } {
  return { noLlm: process.argv.slice(2).includes('--no-llm') };
}

/** 偵測 Ollama 是否可用（決定聚類用 embedding 還是字串相似度）。 */
async function embeddingsAvailable(): Promise<boolean> {
  try {
    await ollamaEmbed('測試');
    return true;
  } catch {
    return false;
  }
}

function groupKey(qa: ExtractedQa): string {
  const model = qa.models[0] ?? 'GENERIC';
  return `${normalizeCategory(qa.category)}||${model}`;
}

/** 用 Gemini 把一個 cluster 的多筆 QA 合併成一篇。 */
async function mergeCluster(qas: ExtractedQa[]): Promise<{
  title: string;
  content: string;
  summary: string;
}> {
  const body = qas
    .map((q, i) => `【問答 ${i + 1}】\nQ: ${q.question}\nA: ${q.answer}`)
    .join('\n\n');
  const raw = await withRetry(() =>
    geminiGenerate({
      systemPrompt: MERGE_SYSTEM_PROMPT,
      userMessage: body,
      temperature: 0.2,
      maxTokens: 1500,
    }),
  );
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '');
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('MERGE_PARSE_FAIL');
  const obj = JSON.parse(match[0]);
  return {
    title: String(obj.title ?? qas[0].question),
    content: String(obj.content ?? qas[0].answer),
    summary: String(obj.summary ?? ''),
  };
}

async function main(): Promise<void> {
  const { noLlm } = parseArgs();
  const all = readJsonl<ExtractedQa>(FILES.extracted);
  console.log(`[04-cluster] 讀入 ${all.length} 則 QA 碎片`);
  if (all.length === 0) {
    console.error('沒有可聚合的 QA，請先跑 03-extract。');
    process.exit(1);
  }

  // 剔除不入 KB 的兩類（仍留在 03-extracted.jsonl，供 05-report 統計信號）：
  //   1. 具體據點/電話（ASR 可能聽錯）  2. 低資訊量（只叫人去問別人）
  const extracted = all.filter(
    (qa) => !isSpecificLocation(qa.answer) && !isLowInfo(qa.answer),
  );
  const dropLoc = all.filter((qa) => isSpecificLocation(qa.answer)).length;
  const dropLow = all.filter(
    (qa) => !isSpecificLocation(qa.answer) && isLowInfo(qa.answer),
  ).length;
  console.log(
    `[04-cluster] 剔除具體據點/電話 ${dropLoc} 則、低資訊量 ${dropLow} 則（不入 KB，僅進分析報告）`,
  );

  const useEmbedding = await embeddingsAvailable();
  console.log(
    useEmbedding
      ? '[04-cluster] Ollama 可用 → 用 embedding + cosine 聚類'
      : '[04-cluster] Ollama 不可用 → fallback 用字串 Jaccard 聚類',
  );

  // Embedding 快取：question → 原始向量。重跑（如加開 Gemini 合併）時直接讀，
  // 免得重算數千次 embedding（bge-m3 在 CPU 每則 ~0.8s，全量約 15 分）。
  const embedCache = new Map<string, number[]>();
  for (const row of readJsonl<{ q: string; v: number[] }>(FILES.embedCache)) {
    embedCache.set(row.q, row.v);
  }
  if (embedCache.size > 0) {
    console.log(`[04-cluster] 讀入 embedding 快取 ${embedCache.size} 筆`);
  }
  const threshold = useEmbedding
    ? CLUSTER_THRESHOLD_COSINE
    : CLUSTER_THRESHOLD_JACCARD;

  // ── Layer 1：硬分組 ──
  const groups = new Map<string, ExtractedQa[]>();
  for (const qa of extracted) {
    const k = groupKey(qa);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(qa);
  }
  console.log(`[04-cluster] 硬分組 ${groups.size} 組`);

  const articles: ArticleDraft[] = [];
  let clusterSeq = 0;
  let groupIdx = 0;
  let embedFail = 0;
  const totalGroups = groups.size;

  for (const [gk, qas] of groups) {
    groupIdx++;
    // ── Layer 2：組內聚類 ──
    // embedding 有界併發（8）——序列逐則太慢；每則帶 timeout（見 ollamaEmbed），
    // 單則失敗就退回字串比對，不讓一則拖垮全組。
    const items: ClusterItem<ExtractedQa>[] = new Array(qas.length);
    if (useEmbedding) {
      const CONCURRENCY = 8;
      for (let i = 0; i < qas.length; i += CONCURRENCY) {
        const slice = qas.slice(i, i + CONCURRENCY);
        const vectors = await Promise.all(
          slice.map(async (qa) => {
            const cached = embedCache.get(qa.question);
            if (cached) return cached;
            try {
              // 只嵌入問句：更聚焦「同問題」，且比 question+answer 短、更快。
              const v = await ollamaEmbed(qa.question);
              embedCache.set(qa.question, v);
              appendJsonl(FILES.embedCache, { q: qa.question, v });
              return v;
            } catch {
              embedFail++;
              return undefined;
            }
          }),
        );
        slice.forEach((qa, j) => {
          items[i + j] = {
            item: qa,
            text: qa.question,
            vector: vectors[j] ? normalizeVector(vectors[j]!) : undefined,
          };
        });
      }
    } else {
      qas.forEach((qa, i) => {
        items[i] = { item: qa, text: qa.question, vector: undefined };
      });
    }
    // 巨型組限制比對最近 400 個代表，避免 O(n²) 卡死（見 cluster.ts 說明）。
    const maxReps = qas.length > 300 ? 400 : 0;
    const clusters = greedyCluster(items, threshold, maxReps);

    // 大組逐一回報（>200 則），其餘每 25 組回報一次。
    if (qas.length > 200 || groupIdx % 25 === 0 || groupIdx === totalGroups) {
      console.log(
        `  [Layer2] 組 ${groupIdx}/${totalGroups} (${gk}, ${qas.length}則→${clusters.length}群)｜累計文章 ${articles.length}｜embed失敗 ${embedFail}`,
      );
    }

    // ── Layer 3：聚合成篇 ──
    for (const cluster of clusters) {
      const members = cluster.map((c) => c.item);
      const frequency = members.length;
      const volatile = members.some((m) => m.volatile);
      const needsReview = members.some((m) => m.needsReview);
      const [category, model] = gk.split('||');
      const tags = [category];
      if (model !== 'GENERIC') tags.push(model);
      const sourceFiles = [...new Set(members.map((m) => m.sourceFile))].slice(0, 5);

      let title: string;
      let content: string;
      let summary: string;

      if (members.length < MERGE_MIN_FREQ || noLlm) {
        // 單筆 / 低頻多筆 / 跳過 LLM：取信心最高的代表筆（不花 Gemini）。
        const rep = [...members].sort((a, b) => b.confidence - a.confidence)[0];
        title = rep.question;
        content = rep.answer;
        summary = '';
      } else {
        // 高頻主題（≥MERGE_MIN_FREQ）才花一次 Gemini 合併成篇。
        try {
          const merged = await mergeCluster(members);
          title = merged.title;
          content = merged.content;
          summary = merged.summary;
        } catch (err) {
          const rep = [...members].sort((a, b) => b.confidence - a.confidence)[0];
          title = rep.question;
          content = rep.answer;
          summary = '';
          console.warn(`  合併失敗（${gk}）：${(err as Error).message}，改用代表筆`);
        }
      }

      // 合併後最終防線：Gemini 可能把多筆來源的門市地址/電話「綜合」進 content
      // （單筆剔除攔不到）。命中則強制 needsReview + 加 tag，讓人工在審核清單看到。
      let finalNeedsReview = needsReview;
      const finalTags = [...tags];
      if (isSpecificLocation(content)) {
        finalNeedsReview = true;
        finalTags.push('含具體地址電話-待清');
      }

      // volatile 文章在內容標更新提示
      if (volatile) {
        content += `\n\n（註：本篇含價格/門市/電話/營業時間等會變動資訊，實際以官方最新公告為準。）`;
      }

      articles.push({
        clusterId: `c${String(++clusterSeq).padStart(4, '0')}`,
        title,
        content,
        summary,
        category,
        tags: finalTags,
        volatile,
        needsReview: finalNeedsReview,
        frequency,
        sourceFiles,
      });
    }
  }

  // 依 frequency 排序（高頻先審）
  articles.sort((a, b) => b.frequency - a.frequency);

  writeJsonl(FILES.articlesJsonl, articles);
  writeCsv(
    FILES.articlesCsv,
    ['clusterId', 'frequency', 'category', 'tags', 'volatile', 'needsReview', 'title', 'content', 'summary', 'sourceFiles'],
    articles.map((a) => ({
      ...a,
      tags: a.tags.join(' | '),
      sourceFiles: a.sourceFiles.join(' | '),
    })),
  );

  console.log('\n───── 04-cluster 完成 ─────');
  console.log(`產出文章：${articles.length} 篇`);
  console.log(`volatile（強制 DRAFT）：${articles.filter((a) => a.volatile).length}`);
  console.log(`needsReview：${articles.filter((a) => a.needsReview).length}`);
  console.log(`Top 10 高頻主題：`);
  for (const a of articles.slice(0, 10)) {
    console.log(`  [${a.frequency}] ${a.category} — ${a.title.slice(0, 40)}`);
  }
  console.log(`\n審核用 CSV：${FILES.articlesCsv}`);
}

main();
