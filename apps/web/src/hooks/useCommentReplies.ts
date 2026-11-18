'use client';

/**
 * 留言自動私訊的 API 呼叫（design.md「API」，前綴 /api/v1/comment-replies）。
 */
import useSWR from 'swr';
import api from '@/lib/api';
import type {
  CommentReplyLogDetail,
  CommentReplyLogItem,
  CommentReplyMaterialOption,
  CommentReplyPost,
  CommentReplyReadiness,
  CommentReplyRuleInput,
  CommentReplyRulePatch,
  CommentReplyRuleView,
  CommentReplyTestResult,
} from '@/lib/comment-reply/types';

const BASE = '/comment-replies';

const fetchData = async <T,>(url: string): Promise<T> => {
  const res = await api.get(url);
  return res.data.data as T;
};

export function useCommentReplyRules(enabled = true) {
  const { data, error, isLoading, mutate } = useSWR<CommentReplyRuleView[]>(
    enabled ? `${BASE}/rules` : null,
    fetchData,
  );
  const rules = [...(data ?? [])].sort((a, b) => a.priority - b.priority);
  return { rules, error, isLoading, mutate };
}

export function useCommentReplyRule(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<CommentReplyRuleView>(
    id ? `${BASE}/rules/${id}` : null,
    fetchData,
  );
  return { rule: data ?? null, error, isLoading, mutate };
}

export function useCommentReplyReadiness(enabled = true) {
  const { data, error, isLoading, mutate } = useSWR<CommentReplyReadiness>(
    enabled ? `${BASE}/readiness` : null,
    fetchData,
  );
  return { readiness: data ?? null, error, isLoading, mutate };
}

export function useCommentReplyMaterialOptions(channelId: string | null) {
  const { data, error, isLoading } = useSWR<CommentReplyMaterialOption[]>(
    channelId ? `${BASE}/material-options?channelId=${encodeURIComponent(channelId)}` : null,
    fetchData,
  );
  return { options: data ?? [], error, isLoading };
}

export async function createCommentReplyRule(input: CommentReplyRuleInput): Promise<CommentReplyRuleView> {
  const res = await api.post(`${BASE}/rules`, input);
  return res.data.data;
}

export async function updateCommentReplyRule(id: string, patch: CommentReplyRulePatch): Promise<CommentReplyRuleView> {
  const res = await api.patch(`${BASE}/rules/${id}`, patch);
  return res.data.data;
}

export async function setCommentReplyRuleActive(id: string, isActive: boolean): Promise<CommentReplyRuleView> {
  const res = await api.patch(`${BASE}/rules/${id}/active`, { isActive });
  return res.data.data;
}

export async function reorderCommentReplyRules(ids: string[]): Promise<void> {
  await api.put(`${BASE}/rules/order`, { ids });
}

export async function deleteCommentReplyRule(id: string): Promise<void> {
  await api.delete(`${BASE}/rules/${id}`);
}

export async function testCommentReplyRules(input: { channelId: string; postId?: string; text: string }): Promise<CommentReplyTestResult> {
  const res = await api.post(`${BASE}/rules/test`, input);
  return res.data.data;
}

export async function fetchCommentReplyPosts(channelId: string, cursor?: string | null): Promise<{ posts: CommentReplyPost[]; nextCursor: string | null }> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const res = await api.get(`${BASE}/channels/${channelId}/posts${qs}`);
  return res.data.data;
}

export async function resolveCommentReplyPost(channelId: string, url: string): Promise<CommentReplyPost> {
  const res = await api.post(`${BASE}/channels/${channelId}/posts/resolve`, { url });
  return res.data.data;
}

export async function subscribeCommentReplyChannel(channelId: string): Promise<{ receiving: boolean }> {
  const res = await api.post(`${BASE}/channels/${channelId}/subscribe-comments`);
  return res.data.data;
}

/** 觸發紀錄的篩選（GET /logs 與 /logs/summary 共用） */
export interface CommentReplyLogFilters {
  statuses: string[];
  channelId?: string;
  ruleId?: string;
  from?: string;
  to?: string;
  q?: string;
}

/** 組查詢字串；status 以重複的 key 送出（status=A&status=B） */
export function buildLogQuery(filters: CommentReplyLogFilters, extra: Record<string, string | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const s of filters.statuses) params.append('status', s);
  if (filters.channelId) params.set('channelId', filters.channelId);
  if (filters.ruleId) params.set('ruleId', filters.ruleId);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.q) params.set('q', filters.q);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) params.set(k, v);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function fetchCommentReplyLogs(
  filters: CommentReplyLogFilters,
  cursor?: string | null,
): Promise<{ items: CommentReplyLogItem[]; nextCursor: string | null }> {
  const res = await api.get(`${BASE}/logs${buildLogQuery(filters, { cursor: cursor ?? undefined, limit: '50' })}`);
  return res.data.data;
}

/** 新紀錄數（GET /logs?since=&countOnly=true） */
export async function countNewCommentReplyLogs(filters: CommentReplyLogFilters, since: string): Promise<number> {
  const res = await api.get(`${BASE}/logs${buildLogQuery(filters, { since, countOnly: 'true' })}`);
  return Number(res.data.data?.count ?? 0);
}

/**
 * 摘要：各狀態筆數＋failed24h。design 沒寫明回應形狀，
 * 這裡同時接受 `{ counts: {...}, failed24h }` 與狀態鍵直接放在最外層兩種寫法。
 */
export interface CommentReplyLogSummary {
  counts: Record<string, number>;
  failed24h: number;
}
export function normalizeLogSummary(raw: unknown): CommentReplyLogSummary {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const source = (obj.counts && typeof obj.counts === 'object' ? obj.counts : obj) as Record<string, unknown>;
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(source)) if (typeof v === 'number' && k !== 'failed24h') counts[k] = v;
  return { counts, failed24h: typeof obj.failed24h === 'number' ? obj.failed24h : 0 };
}

export async function fetchCommentReplyLogSummary(filters: CommentReplyLogFilters): Promise<CommentReplyLogSummary> {
  return normalizeLogSummary(await fetchData<unknown>(`${BASE}/logs/summary${buildLogQuery(filters)}`));
}

export async function fetchCommentReplyLogDetail(id: string): Promise<CommentReplyLogDetail> {
  return fetchData<CommentReplyLogDetail>(`${BASE}/logs/${id}`);
}

export async function retryCommentReplyLog(id: string): Promise<void> {
  await api.post(`${BASE}/logs/${id}/retry`);
}

/** 重新連結 Facebook，完成後回到 returnTo（design：meta-connect/start 加選填 returnTo） */
export async function startMetaReconnect(returnTo: string): Promise<void> {
  const res = await api.post('/meta-connect/start', { returnTo });
  window.location.href = res.data.data.url as string;
}
