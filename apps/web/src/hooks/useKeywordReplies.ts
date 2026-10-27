'use client';

/**
 * Keyword Reply hook — 在 automation rules 之上的薄包裝。
 *
 * 「關鍵字回覆」= 一條 trigger.type = 'keyword.matched' 的 automation rule，
 * 動作含「傳送素材」（send_material）或「發送優惠券」（issue_coupon）至少一個（add-coupon-system design D25）。
 *
 * 這一頁只管理規則上的這兩個動作與關鍵字設定：儲存時只換這兩個動作，規則上的其他動作（例如加標籤）
 * 與其他條件保留原樣，並確保有條件「對話渠道等於規則的渠道」（LINE、Facebook 或 Instagram，
 * change add-fb-ig-keyword-coupon design D2）——沒有渠道條件的話所有渠道的對話都會觸發。
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

// ─── 渠道 ──────────────────────────────────────────────────────────────

/** 關鍵字回覆可選的渠道。值是對話的 channelType；THREADS 是本專案的 Instagram 私訊，畫面一律顯示 Instagram */
export type KeywordReplyChannel = 'LINE' | 'FB' | 'THREADS';

export const KEYWORD_REPLY_CHANNELS: ReadonlyArray<{
  value: KeywordReplyChannel;
  label: string;
  /** 素材庫的 channelType；null 表示這個渠道沒有素材（素材庫目前只有 line、fb） */
  materialChannelType: string | null;
}> = [
  { value: 'LINE', label: 'LINE', materialChannelType: 'line' },
  { value: 'FB', label: 'Facebook', materialChannelType: 'fb' },
  { value: 'THREADS', label: 'Instagram', materialChannelType: null },
];

export function keywordReplyChannelLabel(channel: KeywordReplyChannel): string {
  return KEYWORD_REPLY_CHANNELS.find((c) => c.value === channel)?.label ?? channel;
}

/** 素材庫的 channelType → 關鍵字回覆的渠道；不是可選的渠道時回 null */
function channelOfMaterial(materialChannelType: string | null | undefined): KeywordReplyChannel | null {
  const value = (materialChannelType ?? '').toLowerCase();
  return KEYWORD_REPLY_CHANNELS.find((c) => c.materialChannelType === value)?.value ?? null;
}

const CHANNEL_FACT = 'conversation.channelType';

/** 這一頁加上的渠道條件 */
export function channelCondition(channel: KeywordReplyChannel) {
  return { fact: CHANNEL_FACT, operator: 'equal', value: channel };
}

function isChannelCondition(node: unknown, channel?: KeywordReplyChannel): boolean {
  if (!node || typeof node !== 'object') return false;
  const c = node as Record<string, unknown>;
  return c.fact === CHANNEL_FACT && c.operator === 'equal' && (channel === undefined || c.value === channel);
}

/**
 * 從規則條件讀出渠道（design D2）：頂層 all 只有一個「對話渠道等於 LINE／FB／THREADS」時就是規則的渠道；
 * 沒有任何對話渠道條件時為未限定渠道；其他寫法（等於網站客服、不等於、兩個條件、放在群組裡）這頁無法辨識。
 */
function readChannel(conditions: Record<string, unknown> | null): { channel: KeywordReplyChannel | null; issue: boolean } {
  const all = Array.isArray(conditions?.all) ? (conditions!.all as unknown[]) : [];
  const topLevel = all.filter((n) => (n as Record<string, unknown> | null)?.fact === CHANNEL_FACT);
  const rest = { ...conditions, all: all.filter((n) => !topLevel.includes(n)) };
  const elsewhere = JSON.stringify(rest).includes(`"${CHANNEL_FACT}"`);
  if (topLevel.length === 0 && !elsewhere) return { channel: null, issue: false };
  const value = (topLevel[0] as Record<string, unknown> | undefined)?.value;
  const known = KEYWORD_REPLY_CHANNELS.find((c) => c.value === value)?.value;
  if (!elsewhere && topLevel.length === 1 && known && isChannelCondition(topLevel[0], known)) {
    return { channel: known, issue: false };
  }
  return { channel: null, issue: true };
}

// ─── 素材防線 ────────────────────────────────────────────────────────────

/**
 * 規則傳送的素材不能在這頁使用的原因（PR #364 第二輪審查）。這頁存檔會加上「對話渠道等於規則的渠道」，
 * 素材不是這個渠道的素材時，規則會變成只在這個渠道觸發、卻送別的渠道的素材，從此不再送出，所以要擋下並說明。
 * - other_channel：素材屬於其他渠道（channelLabel 是素材的渠道，ruleChannelLabel 是規則的渠道）
 * - missing：素材已刪除
 * - inactive：素材已停用
 * - unknown：讀不到素材（網路或伺服器錯誤），無法確認，先不讓存檔
 */
export type KeywordReplyMaterialIssue =
  | { kind: 'other_channel'; channelLabel: string; ruleChannelLabel: string }
  | { kind: 'missing' }
  | { kind: 'inactive' }
  | { kind: 'unknown' };

const MATERIAL_CHANNEL_LABELS: Record<string, string> = {
  line: 'LINE',
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
      return `這條規則傳送的是 ${issue.channelLabel} 素材，與所選渠道 ${issue.ruleChannelLabel} 不符，請改選素材或到自動化規則編輯`;
    case 'missing':
      return '這條規則的素材已刪除，請重新選擇素材';
    case 'inactive':
      return '這條規則的素材已停用，請重新選擇素材';
    case 'unknown':
      return '無法確認這條規則的素材，請重新整理頁面後再試';
  }
}

/** 規則的渠道條件這頁無法辨識時（例如限定網站客服），存檔被擋下的說明 */
export const CHANNEL_ISSUE_MESSAGE = '這條規則的渠道條件這頁不能編輯，請到自動化規則編輯';

/** 素材的渠道與狀態；已刪除為 not_found，其他讀取錯誤為 error */
export type MaterialLookup = { channelType?: string | null; isActive?: boolean } | 'not_found' | 'error';

/** 素材能不能在這個渠道的規則使用；null 表示可以（含沒有查詢結果） */
export function materialIssueOf(lookup: MaterialLookup | undefined, channel: KeywordReplyChannel): KeywordReplyMaterialIssue | null {
  if (lookup === undefined) return null;
  if (lookup === 'not_found') return { kind: 'missing' };
  if (lookup === 'error') return { kind: 'unknown' };
  const materialChannel = (lookup.channelType ?? '').toLowerCase();
  if (channelOfMaterial(materialChannel) !== channel) {
    return {
      kind: 'other_channel',
      channelLabel: MATERIAL_CHANNEL_LABELS[materialChannel] ?? (lookup.channelType || '其他渠道'),
      ruleChannelLabel: keywordReplyChannelLabel(channel),
    };
  }
  if (lookup.isActive === false) return { kind: 'inactive' };
  return null;
}

// ─── 列表 ──────────────────────────────────────────────────────────────

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
  /** 規則條件「對話渠道等於 X」的渠道；沒有渠道條件或這頁無法辨識時為 null */
  channel: KeywordReplyChannel | null;
  /** 有渠道條件但不是單一的 LINE、FB 或 THREADS（例如限定網站客服）：這頁不能存檔 */
  channelIssue?: boolean;
  /** 編輯時預設的渠道：有渠道條件時就是它；沒有時為素材的渠道，沒有素材時為 LINE（design D4） */
  defaultChannel: KeywordReplyChannel;
  /** 規則原本素材的查詢結果：判斷素材能不能在所選渠道使用 */
  materialLookup?: MaterialLookup;
  /** 素材不能在 defaultChannel 使用的原因；null 表示沒有問題（含沒有素材） */
  materialIssue?: KeywordReplyMaterialIssue | null;
}

const MANAGED_ACTIONS = new Set(['send_material', 'issue_coupon']);

function stringParam(action: RuleAction | undefined, key: string): string | null {
  const value = action?.params?.[key];
  return typeof value === 'string' && value ? value : null;
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
  const conditions = rule.conditions ?? null;
  const { channel, issue: channelIssue } = readChannel(conditions);
  const materialLookup = materialId ? materials.get(materialId) : undefined;
  const materialChannel = materialLookup && typeof materialLookup === 'object' ? channelOfMaterial(materialLookup.channelType) : null;
  const defaultChannel: KeywordReplyChannel = channel ?? materialChannel ?? 'LINE';
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
    conditions,
    channel,
    channelIssue,
    defaultChannel,
    materialLookup,
    materialIssue: materialId ? materialIssueOf(materialLookup, defaultChannel) : null,
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
  const { data: detailData, mutate: mutateDetails } = useSWR(
    list.length > 0 ? ['keyword-reply-details', list.map((r) => r.id).join(',')] : null,
    async () => {
      const details = (await Promise.all(
        list.map((r) => api.get(`/automation/rules/${r.id}`).then((res) => res.data.data)),
      )) as AutomationRuleDetail[];
      // 素材的渠道與狀態：素材與規則渠道不符的規則不能在這頁存檔（見 KeywordReplyMaterialIssue）
      const materialIds = [...new Set(details.flatMap((d) =>
        (Array.isArray(d.actions) ? d.actions : [])
          .filter((a) => a.type === 'send_material')
          .map((a) => stringParam(a, 'materialId'))
          .filter((id): id is string => id !== null),
      ))];
      return { details, materials: await lookupMaterials(materialIds) };
    },
  );

  // 啟用狀態、名稱與觸發設定以列表的最新值為準：明細的 key 只看規則 id，切換開關後 id 沒變（design D6）
  const listById = new Map(list.map((r) => [r.id, r]));
  const replies = (detailData?.details ?? [])
    .filter((rule) => listById.has(rule.id))
    .map((rule) => {
      const row = listById.get(rule.id)!;
      return ruleToKeywordReply(
        { ...rule, name: row.name, isActive: row.isActive, ...(row.trigger ? { trigger: row.trigger } : {}) },
        detailData!.materials,
      );
    })
    .filter((x): x is KeywordReply => x !== null);

  /**
   * 重新載入列表與規則明細。只重新載入列表的話，規則 id 沒變時明細沿用快取，
   * 畫面停在舊的啟用狀態與內容，要重新整理才更新（PR #364 bot 審查，design D6）
   */
  const reload = async () => {
    await mutate();
    await mutateDetails();
  };

  return { replies, isLoading, error, mutate: reload };
}

// ─── CRUD helpers ──────────────────────────────────────────────────────

export interface KeywordReplyInput {
  name: string;
  /** 規則的渠道：條件綁定「對話渠道等於這個渠道」 */
  channel: KeywordReplyChannel;
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

/** 保留原本的條件，確保有「對話渠道等於所選渠道」（已有就不重複加） */
function withChannelCondition(conditions: Record<string, unknown> | null, channel: KeywordReplyChannel): Record<string, unknown> {
  const condition = channelCondition(channel);
  const all = Array.isArray(conditions?.all) ? (conditions!.all as unknown[]) : null;
  if (all) return all.some((n) => isChannelCondition(n, channel)) ? conditions! : { ...conditions, all: [...all, condition] };
  const any = Array.isArray(conditions?.any) ? (conditions!.any as unknown[]) : null;
  // 「任一」群組：渠道條件與原本的群組都要成立
  if (any && any.length > 0) return { all: [condition, conditions] };
  return { all: [condition] };
}

function buildRulePayload(input: KeywordReplyInput, existing?: KeywordReply): Record<string, unknown> {
  return {
    name: input.name,
    trigger: {
      type: 'keyword.matched',
      keywords: input.keywords,
      match_mode: input.matchMode,
    },
    conditions: withChannelCondition(existing?.conditions ?? null, input.channel),
    actions: mergeActions(existing?.actions ?? [], input),
  };
}

export async function createKeywordReply(input: KeywordReplyInput): Promise<void> {
  await api.post('/automation/rules', buildRulePayload(input));
}

/** 已有渠道條件的規則換了渠道時的說明（design D4） */
export const CHANNEL_LOCKED_MESSAGE = '關鍵字回覆的渠道建立後不能更改，請刪除後重新建立';

/**
 * 這次存檔要不要擋下，回傳要顯示的說明：
 * - 規則的渠道條件這頁無法辨識
 * - 已有渠道條件的規則換了渠道（design D4）
 * - 規則原本的素材不能在所選渠道使用（其他渠道、已刪除、已停用、讀不到），而且沒有改選素材（或拿掉素材）
 * 改選所選渠道的素材或拿掉素材就可以存。
 */
export function keywordReplySaveBlock(
  existing: KeywordReply | null,
  input: Pick<KeywordReplyInput, 'materialId' | 'channel'>,
): string | null {
  if (!existing) return null;
  if (existing.channelIssue) return CHANNEL_ISSUE_MESSAGE;
  if (existing.channel && existing.channel !== input.channel) return CHANNEL_LOCKED_MESSAGE;
  if (!existing.materialId || input.materialId !== existing.materialId) return null;
  const issue = materialIssueOf(existing.materialLookup, input.channel);
  return issue ? materialIssueMessage(issue) : null;
}

export async function updateKeywordReply(
  existing: KeywordReply,
  input: KeywordReplyInput,
): Promise<void> {
  // 頁面已先擋；這裡再擋一次，任何呼叫端都不會把素材不符的規則加上渠道條件而靜默失效
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
