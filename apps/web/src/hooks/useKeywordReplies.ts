'use client';

/**
 * Keyword Reply hook — 在 automation rules 之上的薄包裝。
 *
 * 「關鍵字回覆」= 一條結構固定的 automation rule：
 *   - trigger.type = 'keyword.matched'
 *   - 至少有一個 action.type = 'send_material'
 *
 * 此 hook 過濾出符合這個結構的 rule，並把它們呈現為簡化的「關鍵字 → 素材」模型。
 * 不額外建 KeywordReply 表，沿用 automation 引擎所有保護機制（rate limit / opt-out / AGENT_HANDLED）。
 */

import useSWR from 'swr';
import api from '@/lib/api';

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

interface AutomationRuleRaw {
  id: string;
  name: string;
  description?: string;
  trigger?: { type?: string; keywords?: string[]; match_mode?: string };
  isActive: boolean;
  priority: number;
  createdAt: string;
  // 列表 API 不一定回 actions，所以需 detail 抓
}

interface AutomationRuleDetail extends AutomationRuleRaw {
  actions: Array<{ type: string; params: Record<string, unknown> }>;
}

export interface KeywordReply {
  id: string;
  name: string;
  keywords: string[];
  matchMode: 'any' | 'all';
  materialId: string;
  isActive: boolean;
  createdAt: string;
}

function isKeywordReplyRule(rule: AutomationRuleDetail): boolean {
  if (rule.trigger?.type !== 'keyword.matched') return false;
  return rule.actions?.some((a) => a.type === 'send_material');
}

function ruleToKeywordReply(rule: AutomationRuleDetail): KeywordReply | null {
  if (!isKeywordReplyRule(rule)) return null;
  const sendMaterial = rule.actions.find((a) => a.type === 'send_material');
  const materialId = sendMaterial?.params?.materialId as string | undefined;
  if (!materialId) return null;
  return {
    id: rule.id,
    name: rule.name,
    keywords: rule.trigger?.keywords ?? [],
    matchMode: (rule.trigger?.match_mode as 'any' | 'all') ?? 'any',
    materialId,
    isActive: rule.isActive,
    createdAt: rule.createdAt,
  };
}

/**
 * 列出所有「關鍵字回覆」rules。
 * 1. 用 /automation/rules?trigger=keyword.matched 先窄化
 * 2. 對每條 rule fetch 完整 detail（拿 actions）
 * 3. 過濾出含 send_material 的
 */
export function useKeywordReplies() {
  const { data, error, isLoading, mutate } = useSWR(
    '/automation/rules?trigger=keyword.matched&limit=100',
    fetcher,
  );

  const list = (data?.data ?? []) as AutomationRuleRaw[];

  // 用第二輪請求補 actions
  const { data: detailData } = useSWR(
    list.length > 0 ? ['keyword-reply-details', list.map((r) => r.id).join(',')] : null,
    async () => {
      const details = await Promise.all(
        list.map((r) => api.get(`/automation/rules/${r.id}`).then((res) => res.data.data)),
      );
      return details as AutomationRuleDetail[];
    },
  );

  const replies = (detailData ?? [])
    .map(ruleToKeywordReply)
    .filter((x): x is KeywordReply => x !== null);

  return { replies, isLoading, error, mutate };
}

// ─── CRUD helpers ──────────────────────────────────────────────────────

export interface KeywordReplyInput {
  name: string;
  keywords: string[];
  matchMode: 'any' | 'all';
  materialId: string;
}

function buildRulePayload(input: KeywordReplyInput): Record<string, unknown> {
  return {
    name: input.name,
    trigger: {
      type: 'keyword.matched',
      keywords: input.keywords,
      match_mode: input.matchMode,
    },
    // 空條件群組 — keyword 比對已在 trigger 內，不需額外 fact 條件
    conditions: { all: [] },
    actions: [
      {
        type: 'send_material',
        params: { materialId: input.materialId },
      },
    ],
  };
}

export async function createKeywordReply(input: KeywordReplyInput): Promise<void> {
  await api.post('/automation/rules', buildRulePayload(input));
}

export async function updateKeywordReply(
  id: string,
  input: KeywordReplyInput,
): Promise<void> {
  await api.patch(`/automation/rules/${id}`, buildRulePayload(input));
}

export async function deleteKeywordReply(id: string): Promise<void> {
  await api.delete(`/automation/rules/${id}`);
}

export async function toggleKeywordReply(id: string, isActive: boolean): Promise<void> {
  await api.patch(`/automation/rules/${id}`, { isActive });
}
