/**
 * 後台助理的提示詞與回覆解析（規格 dashboard-guide-assistant）。不讀資料庫：檢索與 LLM 呼叫在 guide-assistant.flow.ts。
 */
import type { GuideDefinition } from '@open333crm/shared';

/** 沒有檢索到文章時的固定答案。這時系統不呼叫 LLM */
export const NO_ARTICLE_ANSWER = '知識庫裡找不到這個問題的說明。';

/** 交給 LLM 的文章篇數 */
export const GUIDE_ASSISTANT_TOP_K = 3;

/** 每篇文章交給 LLM 的字數上限 */
const ARTICLE_CHARS = 1500;

export interface GuideArticle {
  id: string;
  title: string;
  content: string;
  summary: string;
}

/** 檢索到的文章組成知識庫內容 */
export function buildGuideKbContext(articles: GuideArticle[]): string {
  return articles.map((a) => `【${a.title}】\n${(a.content || a.summary).slice(0, ARTICLE_CHARS)}`).join('\n\n');
}

/**
 * 系統提示詞：只依文章回答，並從操作者有權限的導覽中選一條。
 * 只交出導覽的 id 與 title，步驟與 data-guide 值不交給 LLM。
 */
export function buildGuideSystemPrompt(guides: GuideDefinition[], currentPath?: string): string {
  const list = guides.length > 0 ? guides.map((g) => `- ${g.id}：${g.title}`).join('\n') : '（沒有可用的導覽）';
  return [
    '你是 Open333 CRM 後台的操作助理，回答後台員工「怎麼操作系統」的問題。',
    '規則：',
    '1. 只根據下方的知識庫內容回答。內容沒有提到的功能或步驟，回答「知識庫裡找不到這部分的說明」，不要自己推測。',
    '2. 用條列的步驟回答，使用繁體中文，不要用 Markdown 標題或粗體符號。',
    '3. 只可以附上知識庫內容裡出現的網址，不可以自己組網址。',
    '4. 從下方的導覽清單選一條最符合問題的導覽，填入 guideId。沒有符合的導覽時，guideId 填 null。',
    '5. 只回傳一個 JSON 物件，格式是 {"answer": "答案", "guideId": "導覽 id 或 null"}，不要加其他文字。',
    currentPath ? `員工目前在頁面 ${currentPath}。` : '',
    '導覽清單：',
    list,
  ]
    .filter(Boolean)
    .join('\n');
}

export interface ParsedGuideReply {
  answer: string;
  guideId: string | null;
}

/**
 * 解析 LLM 的回覆。回覆不是 `{ answer, guideId }` 格式的 JSON 時，整段回覆當作答案，guideId 是 null。
 * 模型常把 JSON 包在 ```json 區塊裡，解析前先去掉區塊符號。
 */
export function parseGuideReply(raw: string): ParsedGuideReply {
  const text = raw.trim();
  const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed: unknown = JSON.parse(unfenced);
    if (parsed && typeof parsed === 'object' && typeof (parsed as { answer?: unknown }).answer === 'string') {
      const { answer, guideId } = parsed as { answer: string; guideId?: unknown };
      return { answer, guideId: typeof guideId === 'string' ? guideId : null };
    }
  } catch {
    // 不是 JSON：整段回覆當作答案
  }
  return { answer: text, guideId: null };
}
