'use client';

/**
 * 加好友禮 hook（add-coupon-system design D28）——在 automation rules 之上的薄包裝，比照 useKeywordReplies。
 *
 * 「加好友禮」= 一條事件為「加入好友」（contact.followed）、動作含「發送優惠券」（issue_coupon）的規則，
 * 每個租戶一條：已有就更新那一條（多條時取最早建立的），沒有才建立。
 *
 * 儲存時：
 * - 條件一定有「第一次加入等於是」（封鎖後再加入不發券，使用者決定）與「對話渠道等於 LINE」，
 *   已有就不重複加；在自動化規則編輯器被移除的話，這裡存檔會補回。其他條件保留原樣。
 * - 只換「發送優惠券」動作的券與「發不出時回覆顧客」，其他動作（例如加標籤）保留原樣。
 */

import useSWR from 'swr';
import api from '@/lib/api';
import { fetchAllPages } from '@/lib/fetch-all-pages';

type RuleAction = { type: string; params?: Record<string, unknown> };
type Condition = Record<string, unknown>;

interface AutomationRuleSummary {
  id: string;
  name: string;
  trigger?: { type?: string };
  isActive: boolean;
  createdAt: string;
}

interface AutomationRuleDetail extends AutomationRuleSummary {
  actions?: RuleAction[];
  conditions?: Condition | null;
}

export const FOLLOW_GIFT_EVENT = 'contact.followed';
export const FOLLOW_GIFT_DEFAULT_NAME = '加好友禮';

/** 只發給第一次加入（頁面固定帶上、不能移除） */
export const FIRST_FOLLOW_CONDITION = { fact: 'follow.isFirst', operator: 'equal', value: true } as const;
/** 加入好友只有 LINE 會送出；明寫渠道，與關鍵字回覆頁一致 */
export const LINE_CHANNEL_CONDITION = { fact: 'conversation.channelType', operator: 'equal', value: 'LINE' } as const;

export interface FollowGift {
  id: string;
  name: string;
  isActive: boolean;
  couponId: string | null;
  failureText: string;
  actions: RuleAction[];
  conditions: Condition | null;
}

export interface FollowGiftInput {
  enabled: boolean;
  couponId: string;
  failureText: string;
}

function toFollowGift(rule: AutomationRuleDetail): FollowGift | null {
  const actions = Array.isArray(rule.actions) ? rule.actions : [];
  const issue = actions.find((a) => a.type === 'issue_coupon');
  if (!issue) return null;
  const couponId = typeof issue.params?.couponId === 'string' && issue.params.couponId ? issue.params.couponId : null;
  const failureText = typeof issue.params?.failureText === 'string' ? issue.params.failureText : '';
  return {
    id: rule.id,
    name: rule.name,
    isActive: rule.isActive,
    couponId,
    failureText,
    actions,
    conditions: rule.conditions ?? null,
  };
}

/** 租戶的加好友禮規則；沒有時為 null */
export function useFollowGift() {
  const { data, error, isLoading, mutate } = useSWR(`follow-gift:${FOLLOW_GIFT_EVENT}`, async () => {
    const list = await fetchAllPages<AutomationRuleSummary>(
      (url, config) => api.get(url, config),
      `/automation/rules?trigger=${FOLLOW_GIFT_EVENT}`,
    );
    // 最早建立的優先：每次開頁都編輯同一條
    const ordered = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const summary of ordered) {
      const detail = (await api.get(`/automation/rules/${summary.id}`)).data.data as AutomationRuleDetail;
      const gift = toFollowGift(detail);
      if (gift) return gift;
    }
    return null;
  });
  return { gift: data ?? null, isLoading, error, mutate };
}

function sameCondition(node: unknown, target: Condition): boolean {
  if (!node || typeof node !== 'object') return false;
  const c = node as Condition;
  return c.fact === target.fact && c.operator === target.operator && c.value === target.value;
}

/** 保留原本的條件，確保有「第一次加入等於是」與「對話渠道等於 LINE」（已有就不重複加） */
export function withFollowGiftConditions(conditions: Condition | null): Condition {
  const required = [FIRST_FOLLOW_CONDITION, LINE_CHANNEL_CONDITION];
  const all = Array.isArray(conditions?.all) ? (conditions!.all as unknown[]) : null;
  if (all) {
    const missing = required.filter((r) => !all.some((node) => sameCondition(node, r)));
    return missing.length === 0 ? conditions! : { ...conditions, all: [...all, ...missing.map((r) => ({ ...r }))] };
  }
  const any = Array.isArray(conditions?.any) ? (conditions!.any as unknown[]) : null;
  // 「任一」群組：固定條件與原本的群組都要成立
  if (any && any.length > 0) return { all: [...required.map((r) => ({ ...r })), conditions] };
  return { all: required.map((r) => ({ ...r })) };
}

/** 換掉「發送優惠券」的券與「發不出時回覆顧客」，其他動作的位置與內容不動；同類動作只留第一個 */
export function withFollowGiftAction(existing: RuleAction[], input: FollowGiftInput): RuleAction[] {
  const failureText = input.failureText.trim();
  const merged: RuleAction[] = [];
  let placed = false;
  for (const action of existing) {
    if (action.type !== 'issue_coupon') {
      merged.push(action);
      continue;
    }
    if (placed) continue;
    placed = true;
    const { failureText: _old, ...rest } = action.params ?? {};
    merged.push({ type: 'issue_coupon', params: { ...rest, couponId: input.couponId, ...(failureText ? { failureText } : {}) } });
  }
  if (!placed) {
    merged.push({ type: 'issue_coupon', params: { couponId: input.couponId, ...(failureText ? { failureText } : {}) } });
  }
  return merged;
}

/** 建立或更新租戶唯一的加好友禮規則 */
export async function saveFollowGift(existing: FollowGift | null, input: FollowGiftInput): Promise<void> {
  const body = {
    name: existing?.name || FOLLOW_GIFT_DEFAULT_NAME,
    trigger: { type: FOLLOW_GIFT_EVENT },
    conditions: withFollowGiftConditions(existing?.conditions ?? null),
    actions: withFollowGiftAction(existing?.actions ?? [], input),
    isActive: input.enabled,
  };
  if (existing) {
    await api.patch(`/automation/rules/${existing.id}`, body);
  } else {
    await api.post('/automation/rules', body);
  }
}
