/**
 * Sentiment Analysis Service — 解析 LLM 的情緒分析結果與關鍵字降級。
 * 呼叫 LLM 在 ai.flow.ts（change migrate-ai-llm-tenant-ctx，design D7）。
 */

export interface SentimentResult {
  sentiment: 'positive' | 'neutral' | 'negative';
  score: number;       // -1 to 1
  confidence: number;  // 0 to 1
}

export const SENTIMENT_SYSTEM_PROMPT =
  '你是一位情感分析助手。分析以下客戶訊息的情感傾向。' +
  '請以 JSON 格式回覆，格式為：{"sentiment":"positive"|"neutral"|"negative","score":-1到1的數字,"confidence":0到1的數字}。' +
  'score: 正面為正數，負面為負數，中性接近0。' +
  '只回覆 JSON，不要有其他文字。';

/**
 * Keyword-based fallback when LLM response is invalid.
 */
export function sentimentByKeywords(text: string): SentimentResult {
  const negativeKeywords = ['差', '爛', '糟', '慢', '壞', '騙', '怒', '氣', '投訴', '退', '不滿', '失望', '垃圾', '太差', '噁心', '無恥', '可惡', '離譜'];
  const positiveKeywords = ['好', '讚', '棒', '感謝', '謝謝', '滿意', '開心', '喜歡', '優秀', '推薦', '很好', '不錯', '優質', '快速'];

  const lower = text.toLowerCase();
  let negCount = 0;
  let posCount = 0;

  for (const kw of negativeKeywords) {
    if (lower.includes(kw)) negCount++;
  }
  for (const kw of positiveKeywords) {
    if (lower.includes(kw)) posCount++;
  }

  if (negCount > posCount) {
    return { sentiment: 'negative', score: -0.6, confidence: 0.5 };
  }
  if (posCount > negCount) {
    return { sentiment: 'positive', score: 0.6, confidence: 0.5 };
  }
  return { sentiment: 'neutral', score: 0, confidence: 0.4 };
}

/** 解析 LLM 的回覆；不是合法的 JSON 時改用關鍵字判斷 */
export function parseSentimentReply(raw: string, text: string): SentimentResult {
  const jsonMatch = raw.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return sentimentByKeywords(text);
  let parsed: { sentiment?: unknown; score?: unknown; confidence?: unknown };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return sentimentByKeywords(text);
  }
  const sentiment = (['positive', 'neutral', 'negative'] as const).includes(parsed.sentiment as SentimentResult['sentiment'])
    ? (parsed.sentiment as SentimentResult['sentiment'])
    : 'neutral';
  const score = typeof parsed.score === 'number'
    ? Math.max(-1, Math.min(1, parsed.score))
    : 0;
  const confidence = typeof parsed.confidence === 'number'
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0.5;
  return { sentiment, score, confidence };
}
