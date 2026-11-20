/**
 * 後台助理的問答（規格 dashboard-guide-assistant）。
 *
 * 1. 以 searchArticlesByTextFlow() 檢索本租戶的已發布文章（向量化在交易外，搜尋在 inTenant() 的交易內）。
 * 2. 沒有文章時回固定答案，不呼叫 LLM。
 * 3. 有文章時以 generateReply() 呼叫 LLM：generateReply() 檢查月額度、套用 AI 隱私政策，並記錄 feature guide-assistant 的用量。
 * 4. 檢查 LLM 選的導覽在操作者有權限的導覽之中，不在時 guide 是 null。
 *
 * 這個 flow 不寫入租戶資料。
 */
import { guidesForPermissions, type GuideDefinition } from '@open333crm/shared';
import { AppError } from '../../shared/utils/response.js';
import { searchArticlesByTextFlow } from '../embedding/embedding.flow.js';
import { generateReply, type LlmDeps } from './llm.flow.js';
import type { HistoryMessage } from './llm.service.js';
import {
  GUIDE_ASSISTANT_TOP_K,
  NO_ARTICLE_ANSWER,
  buildGuideKbContext,
  buildGuideSystemPrompt,
  parseGuideReply,
} from './guide-assistant.service.js';

export interface GuideAssistantInput {
  message: string;
  history: HistoryMessage[];
  currentPath?: string;
}

export interface GuideAssistantAnswer {
  answer: string;
  guide: GuideDefinition | null;
  sources: Array<{ id: string; title: string }>;
}

export async function askGuideAssistantFlow(
  deps: LlmDeps,
  tenantId: string,
  input: GuideAssistantInput,
  permissions: ReadonlySet<string>,
): Promise<GuideAssistantAnswer> {
  const guides = guidesForPermissions(permissions);
  try {
    const articles = (await searchArticlesByTextFlow(deps, tenantId, input.message)).slice(0, GUIDE_ASSISTANT_TOP_K);
    if (articles.length === 0) return { answer: NO_ARTICLE_ANSWER, guide: null, sources: [] };

    const raw = await generateReply(deps, tenantId, input.message, buildGuideKbContext(articles), {
      overrideSystemPrompt: buildGuideSystemPrompt(guides, input.currentPath),
      history: input.history,
      meta: { feature: 'guide-assistant' },
    });
    const { answer, guideId } = parseGuideReply(raw);
    return {
      answer,
      guide: guides.find((g) => g.id === guideId) ?? null,
      sources: articles.map((a) => ({ id: a.id, title: a.title })),
    };
  } catch (err) {
    // 月額度已滿（PLAN_LIMIT_EXCEEDED）等 AppError 原樣往上；向量化或 LLM 服務的錯誤改成 503，不回裸 500
    if (err instanceof AppError) throw err;
    throw new AppError('助理暫時無法回答，請稍後再試。', 'SERVICE_UNAVAILABLE', 503);
  }
}
