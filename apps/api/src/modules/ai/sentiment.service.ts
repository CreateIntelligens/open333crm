/**
 * Sentiment Analysis Service — uses Ollama LLM to analyze message sentiment.
 */

import { generateReply } from './llm.service.js';

export interface SentimentResult {
  sentiment: 'positive' | 'neutral' | 'negative';
  score: number;       // -1 to 1
  confidence: number;  // 0 to 1
}

const SENTIMENT_SYSTEM_PROMPT =
  '你是一位情感分析助手。分析以下客戶訊息的情感傾向。' +
  '請以 JSON 格式回覆，格式為：{"sentiment":"positive"|"neutral"|"negative","score":-1到1的數字,"confidence":0到1的數字}。' +
  'score: 正面為正數，負面為負數，中性接近0。' +
  '只回覆 JSON，不要有其他文字。';

/**
 * Keyword-based fallback when LLM response is invalid.
 */
function keywordFallback(text: string): SentimentResult {
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

export async function analyzeSentiment(text: string): Promise<SentimentResult> {
  try {
    const raw = await generateReply(SENTIMENT_SYSTEM_PROMPT, text, '');

    // Try to parse JSON from LLM response
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const sentiment = ['positive', 'neutral', 'negative'].includes(parsed.sentiment)
        ? parsed.sentiment
        : 'neutral';
      const score = typeof parsed.score === 'number'
        ? Math.max(-1, Math.min(1, parsed.score))
        : 0;
      const confidence = typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5;
      return { sentiment, score, confidence };
    }

    // LLM didn't return valid JSON, use keyword fallback
    return keywordFallback(text);
  } catch (err) {
    console.error('[Sentiment] LLM analysis failed, using keyword fallback:', err);
    return keywordFallback(text);
  }
}
