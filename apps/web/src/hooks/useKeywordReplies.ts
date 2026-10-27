'use client';

/**
 * Keyword Reply hook — 在 automation rules 之上的薄包裝。
 *
 * 「關鍵字回覆」= 一條 trigger.type = 'keyword.matched' 的 automation rule，
 * 動作含「傳送素材」（send_material）或「發送優惠券」（issue_coupon）至少一個（add-coupon-system design D25）。
 *
 * 這一頁只管理規則上的這兩個動作與關鍵字設定：儲存時只換這兩個動作，規則上的其他動作（例如加標籤）
 * 與其他條件保留原樣，並確保有條件「對話渠道等於 LINE」——這頁叫「LINE 關鍵字回覆」，
 * 沒有渠道條件的話 FB、IG、網站客服的對話也會觸發，發券就會發到 LINE 以外的渠道。
 * 不額外建 KeywordReply 表，沿用 automation 引擎所有保護機制（rate limit / opt-out / AGENT_HANDLED）。
 */

import useSWR from 'swr';
import api from '@/lib/api';
import { fetchAllPages } from '@/lib/fetch-all-pages';

type RuleAction = { type: string; params?: Record<string, unknown> };

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

export interface AutomationRuleDetail extends AutomationRuleRaw {
  actions: RuleAction[];
  conditions?: Record<string, unknown> | null;
}

/**
 * 規則傳送的素材不能在這頁使用的原因（PR #364 第二輪審查）。這頁存檔一律加上「對話渠道等於 LINE」，
 * 素材不是 LINE 素材時規則會變成只在 LINE 觸發、卻送別的渠道的素材，從此不再送出，所以要擋下並說明。
 * - other_channel：素材屬於其他渠道（在一般自動化規則建立的）
 * - missing：素材已刪除
 * - inactive：素材已停用
 * - unknown：讀不到素材（網路或伺服器錯誤），無法確認，先不讓存檔
 */
export type KeywordReplyMaterialIssue =
  | { kind: 'other_channel'; channelLabel: string }
  | { kind: 'missing' }
  | { kind: 'inactive' }
  | { kind: 'unknown' };

const MATERIAL_CHANNEL_LABELS: Record<string, string> = {
  fb: 'Facebook',
  facebook: 'Facebook',
  threads: 'Instagram',
  instagram: 'Instagram',
  ig: 'Instagram',
  webchat: '網站客服',
};

/** 存檔被擋下時顯示的說明 */
export function materialIssueMessage(issue: KeywordReplyMaterialIssue): string {
  switch (issue.kind) {
    case 'other_channel':
      return `這條規則傳送的是 ${issue.channelLabel} 素材，請到自動化規則編輯`;
    case 'missing':
      return '這條規則的素材已刪除，請重新選擇 LINE 素材';
    case 'inactive':
      return '這條規則的素材已停用，請重新選擇 LINE 素材';
    case 'unknown':
      return '無法確認這條規則的素材，請重新整理頁面後再試';
  }
}

export interface KeywordReply {
  id: string;
  name: string;
  keywords: string[];
  matchMode: 'any' | 'all';
  /** 傳送的素材；只發券的規則沒有 */
  materialId: string | null;
  /** 發送的優惠券；只傳素材的規則沒有 */
  couponId: string | null;
  /** 發不出時回覆顧客（空字串表示不回覆） */
  failureText: string;
  isActive: boolean;
  createdAt: string;
  /** 規則原本的動作與條件：儲存時保留這一頁不管的部分 */
  actions: RuleAction[];
  conditions: Record<string, unknown> | null;
  /** 素材不能在這頁使用的原因；null 表示沒有問題（含沒有素材） */
  materialIssue?: KeywordReplyMaterialIssue | null;
}

const MANAGED_ACTIONS = new Set(['send_material', 'issue_coupon']);

/** 這一頁加上的渠道條件 */
export const LINE_CHANNEL_CONDITION = { fact: 'conversation.channelType', operator: 'equal', value: 'LINE' } as const;

function stringParam(action: RuleAction | undefined, key: string): string | null {
  const value = action?.params?.[key];
  return typeof value === 'string' && value ? value : null;
}

type MaterialLookup = { channelType?: string | null; isActive?: boolean } | 'not_found' | 'error';

function materialIssueOf(lookup: MaterialLookup | undefined): KeywordReplyMaterialIssue | null {
  if (lookup === undefined) return null;
  if (lookup === 'not_found') return { kind: 'missing' };
  if (lookup === 'error') return { kind: 'unknown' };
  const channel = (lookup.channelType ?? '').toLowerCase();
  if (channel !== 'line') return { kind: 'other_channel', channelLabel: MATERIAL_CHANNEL_LABELS[channel] ?? (lookup.channelType || '其他渠道') };
  if (lookup.isActive === false) return { kind: 'inactive' };
  return null;
}

/** 讀出每個素材的渠道與狀態；已刪除回 not_found，其他錯誤回 error */
async function lookupMaterials(ids: string[]): Promise<Map<string, MaterialLookup>> {
  const entries = await Promise.all(
    ids.map(async (id): Promise<[string, MaterialLookup]> => {
      try {
        const res = await api.get(`/marketing/materials/${id}`);
        const m = res.data.data as { channelType?: string | null; isActive?: boolean };
        return [id, { channelType: m?.channelType, isActive: m?.isActive }];
      } catch (err) {
        const status = (err as { response?: { status?: number } }).response?.status;
        return [id, status === 404 ? 'not_found' : 'error'];
      }
    }),
  );
  return new Map(entries);
}

function ruleToKeywordReply(rule: AutomationRuleDetail, materials: Map<string, MaterialLookup>): KeywordReply | null {
  if (rule.trigger?.type !== 'keyword.matched') return null;
  const actions = Array.isArray(rule.actions) ? rule.actions : [];
  const materialId = stringParam(actions.find((a) => a.type === 'send_material'), 'materialId');
  const issueCoupon = actions.find((a) => a.type === 'issue_coupon');
  const couponId = stringParam(issueCoupon, 'couponId');
  if (!materialId && !couponId) return null;
  return {
    id: rule.id,
    name: rule.name,
    keywords: rule.trigger?.keywords ?? [],
    matchMode: (rule.trigger?.match_mode as 'any' | 'all') ?? 'any',
    materialId,
    couponId,
    failureText: stringParam(issueCoupon, 'failureText') ?? '',
    isActive: rule.isActive,
    createdAt: rule.createdAt,
    actions,
    conditions: rule.conditions ?? null,
    materialIssue: materialId ? materialIssueOf(materials.get(materialId)) : null,
  };
}

/**
 * 列出所有「關鍵字回覆」rules。
 * 1. 用 /automation/rules?trigger=keyword.matched 先窄化
 * 2. 對每條 rule fetch 完整 detail（拿 actions）
 * 3. 過濾出含 send_material 或 issue_coupon 的
 */
export function useKeywordReplies() {
  const { data, error, isLoading, mutate } = useSWR(
    '/automation/rules?trigger=keyword.matched',
    // 原本只取一頁 100 條，之後的關鍵字回覆在頁面上看不到
    (url: string) => fetchAllPages<AutomationRuleRaw>((u, config) => api.get(u, config), url),
  );

  const list = data ?? [];

  // 用第二輪請求補 actions
  const { data: detailData } = useSWR(
    list.length > 0 ? ['keyword-reply-details', list.map((r) => r.id).join(',')] : null,
    async () => {
      const details = (await Promise.all(
        list.map((r) => api.get(`/automation/rules/${r.id}`).then((res) => res.data.data)),
      )) as AutomationRuleDetail[];
      // 素材的渠道與狀態：非 LINE 素材的規則不能在這頁存檔（見 KeywordReplyMaterialIssue）
      const materialIds = [...new Set(details.flatMap((d) =>
        (Array.isArray(d.actions) ? d.actions : [])
          .filter((a) => a.type === 'send_material')
          .map((a) => stringParam(a, 'materialId'))
          .filter((id): id is string => id !== null),
      ))];
      return { details, materials: await lookupMaterials(materialIds) };
    },
  );

  const replies = (detailData?.details ?? [])
    .map((rule) => ruleToKeywordReply(rule, detailData!.materials))
    .filter((x): x is KeywordReply => x !== null);

  return { replies, isLoading, error, mutate };
}

// ─── CRUD helpers ──────────────────────────────────────────────────────

export interface KeywordReplyInput {
  name: string;
  keywords: string[];
  matchMode: 'any' | 'all';
  materialId: string | null;
  couponId: string | null;
  failureText: string;
}

/**
 * 換掉這一頁管理的動作，其他動作的位置與內容不動。素材在前、發券在後（新規則的順序）；
 * 原本就有的動作留在原位。發券動作保留它其他的參數，只換券與「發不出時回覆顧客」。
 */
function mergeActions(existing: RuleAction[], input: KeywordReplyInput): RuleAction[] {
  const next: Record<string, RuleAction | null> = {
    send_material: input.materialId ? { type: 'send_material', params: { materialId: input.materialId } } : null,
    issue_coupon: input.couponId
      ? (() => {
          const previous = existing.find((a) => a.type === 'issue_coupon')?.params ?? {};
          const { failureText: _old, ...rest } = previous;
          const failureText = input.failureText.trim();
          return { type: 'issue_coupon', params: { ...rest, couponId: input.couponId, ...(failureText ? { failureText } : {}) } };
        })()
      : null,
  };
  const placed = new Set<string>();
  const merged: RuleAction[] = [];
  for (const action of existing) {
    if (!MANAGED_ACTIONS.has(action.type)) {
      merged.push(action);
      continue;
    }
    // 同類動作只留一個（這一頁只顯示第一個）
    if (placed.has(action.type)) continue;
    placed.add(action.type);
    const replacement = next[action.type];
    if (replacement) merged.push(replacement);
  }
  for (const type of ['send_material', 'issue_coupon']) {
    const action = next[type];
    if (action && !placed.has(type)) merged.push(action);
  }
  return merged;
}

function isLineCondition(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const c = node as Record<string, unknown>;
  return c.fact === LINE_CHANNEL_CONDITION.fact && c.operator === LINE_CHANNEL_CONDITION.operator && c.value === LINE_CHANNEL_CONDITION.value;
}

/** 保留原本的條件，確保有「對話渠道等於 LINE」（已有就不重複加） */
function withLineCondition(conditions: Record<string, unknown> | null): Record<string, unknown> {
  const all = Array.isArray(conditions?.all) ? (conditions!.all as unknown[]) : null;
  if (all) return all.some(isLineCondition) ? conditions! : { ...conditions, all: [...all, { ...LINE_CHANNEL_CONDITION }] };
  const any = Array.isArray(conditions?.any) ? (conditions!.any as unknown[]) : null;
  // 「任一」群組：LINE 條件與原本的群組都要成立
  if (any && any.length > 0) return { all: [{ ...LINE_CHANNEL_CONDITION }, conditions] };
  return { all: [{ ...LINE_CHANNEL_CONDITION }] };
}

function buildRulePayload(input: KeywordReplyInput, existing?: KeywordReply): Record<string, unknown> {
  return {
    name: input.name,
    trigger: {
      type: 'keyword.matched',
      keywords: input.keywords,
      match_mode: input.matchMode,
    },
    conditions: withLineCondition(existing?.conditions ?? null),
    actions: mergeActions(existing?.actions ?? [], input),
  };
}

export async function createKeywordReply(input: KeywordReplyInput): Promise<void> {
  await api.post('/automation/rules', buildRulePayload(input));
}

/**
 * 這次存檔要不要擋下：規則原本的素材不能在這頁使用，而且沒有改選素材（或拿掉素材）時擋下，
 * 回傳要顯示的說明。改選 LINE 素材或拿掉素材就可以存。
 */
export function keywordReplySaveBlock(existing: KeywordReply | null, input: Pick<KeywordReplyInput, 'materialId'>): string | null {
  if (!existing?.materialIssue || !existing.materialId) return null;
  return input.materialId === existing.materialId ? materialIssueMessage(existing.materialIssue) : null;
}

export async function updateKeywordReply(
  existing: KeywordReply,
  input: KeywordReplyInput,
): Promise<void> {
  // 頁面已先擋；這裡再擋一次，任何呼叫端都不會把非 LINE 素材的規則加上 LINE 條件而靜默失效
  const blocked = keywordReplySaveBlock(existing, input);
  if (blocked) throw new Error(blocked);
  await api.patch(`/automation/rules/${existing.id}`, buildRulePayload(input, existing));
}

export async function deleteKeywordReply(id: string): Promise<void> {
  await api.delete(`/automation/rules/${id}`);
}

export async function toggleKeywordReply(id: string, isActive: boolean): Promise<void> {
  await api.patch(`/automation/rules/${id}`, { isActive });
}
