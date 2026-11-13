/**
 * 留言規則的業務邏輯與資料存取（change add-comment-keyword-private-reply design「API」、D15、D20、D22；
 * spec comment-reply-rules、plan-limits-core「留言規則啟用數硬擋」）。
 *
 * service 只收 TenantCtx（結構規則 2）；稽核、快取失效等副作用在 comment-reply.flow.ts。
 * 輸入已由路由以 parseRuleInput()／parseRulePatch() 驗證；PATCH 合併既有值後這裡再以 parseRuleInput() 驗證一次。
 * 試算（testRules）與收件共用 listActiveRulesForChannel() 與 matchCommentRule()，對同一組輸入結果相同。
 */
import type { CommentReplyRule, Prisma } from '@prisma/client';
import type { ChannelCommentExtension } from '@open333crm/channel-plugins';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { AppError } from '../../shared/utils/response.js';
import { bodyHasCouponUrl, COUPON_URL_KEY } from '../marketing/template-renderer.js';
import { getEffectiveLimit } from '../platform/plan-limits.service.js';
import {
  canEditChannel,
  channelAccountId,
  channelIdFilter,
  channelLevel,
  commentExtensionOf,
  commentReplySettingsOf,
  resolveViewerChannels,
  type CommentReplyViewer,
  type ViewerChannels,
} from './comment-reply-access.js';
import { COMMENT_REPLY_FORBIDDEN_MATERIAL_TYPES } from './comment-reply-content.js';
import { matchCommentRule } from './comment-reply-match.js';
import { capabilityName, type CommentReplyPlatformSettings } from './comment-reply-platform-settings.js';
import { parseRuleInput, type RuleInput, type RulePatch } from './comment-reply.schemas.js';
import type { CommentReplyMatchMode, CommentReplyPostScope, CommentReplyWarningCode } from './comment-reply.types.js';

// ─── 回應形狀（design RuleView；前端 apps/web/src/lib/comment-reply/types.ts） ────────────

export interface RuleView {
  id: string;
  name: string;
  channelId: string;
  channel: { id: string; channelType: string; displayName: string; accountId: string | null };
  keywords: string[];
  matchMode: CommentReplyMatchMode;
  postScope: CommentReplyPostScope;
  posts: Array<{ postId: string; permalink: string | null; thumbnailUrl: string | null; excerpt: string | null; publishedAt: string | null }>;
  content:
    | { type: 'text'; text: string }
    | { type: 'material'; materialId: string | null; materialName: string | null; materialStatus: 'ACTIVE' | 'INACTIVE' | 'DELETED' };
  dedupePerCommenter: boolean;
  publicReply: { enabled: boolean; texts: string[] };
  isActive: boolean;
  priority: number;
  canEdit: boolean;
  stats7d: { sent: number; failed: number; expired: number; duplicate: number };
  warnings: CommentReplyWarningCode[];
}

const RULE_NOT_FOUND = () => new AppError('找不到這條規則', 'RULE_NOT_FOUND', 404);
const CHANNEL_ACCESS_DENIED = () =>
  new AppError('你對這個渠道只有檢視權限，無法修改規則', 'CHANNEL_ACCESS_DENIED', 403);

const channelSelect = {
  id: true,
  channelType: true,
  displayName: true,
  externalAccountId: true,
  credentialsEncrypted: true,
  settings: true,
  isActive: true,
} as const;
type RuleChannel = Prisma.ChannelGetPayload<{ select: typeof channelSelect }>;

const ruleInclude = {
  channel: { select: channelSelect },
  material: { select: { id: true, name: true, isActive: true } },
} as const;
type RuleRow = Prisma.CommentReplyRuleGetPayload<{ include: typeof ruleInclude }>;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredSnapshot {
  postId: string;
  permalink?: string | null;
  thumbnailUrl?: string | null;
  excerpt?: string | null;
  publishedAt?: string | null;
}

function snapshotsOf(rule: Pick<CommentReplyRule, 'postIds' | 'postSnapshots'>): StoredSnapshot[] {
  const list = Array.isArray(rule.postSnapshots) ? (rule.postSnapshots as unknown as StoredSnapshot[]) : [];
  const byId = new Map(list.filter((s) => s && typeof s.postId === 'string').map((s) => [s.postId, s]));
  return rule.postIds.map((postId) => byId.get(postId) ?? { postId });
}

// ─── 讀取 ────────────────────────────────────────────────────────────────

/**
 * 某渠道啟用中、未刪除的規則，依 priority、建立時間排序（matchCommentRule 對同 priority 保持輸入順序）。
 * 收件 flow 與試算共用，兩邊對同一則留言得到同一條規則。
 */
export async function listActiveRulesForChannel(ctx: TenantCtx, channelId: string): Promise<CommentReplyRule[]> {
  return ctx.tx.commentReplyRule.findMany({
    where: { tenantId: ctx.tenantId, channelId, isActive: true, deletedAt: null },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
}

async function countActiveRules(ctx: TenantCtx): Promise<number> {
  return ctx.tx.commentReplyRule.count({ where: { tenantId: ctx.tenantId, isActive: true, deletedAt: null } });
}

/** 規則列表需要的共用資料：上限、啟用數、7 天統計 */
async function viewContext(ctx: TenantCtx, ruleIds: string[]) {
  const [maxRules, activeRules, stats] = await Promise.all([
    getEffectiveLimit(ctx.tx, ctx.tenantId, 'maxCommentReplyRules'),
    countActiveRules(ctx),
    ruleIds.length
      ? ctx.tx.commentReplyLog.groupBy({
          by: ['ruleId', 'status'],
          where: { tenantId: ctx.tenantId, ruleId: { in: ruleIds }, createdAt: { gte: new Date(Date.now() - SEVEN_DAYS_MS) } },
          _count: { _all: true },
        })
      : Promise.resolve([] as Array<{ ruleId: string; status: string; _count: { _all: number } }>),
  ]);
  return { overLimit: maxRules !== null && activeRules > maxRules, stats };
}

function toView(rule: RuleRow, viewer: CommentReplyViewer, channels: ViewerChannels, vc: Awaited<ReturnType<typeof viewContext>>): RuleView {
  const count = (status: string) => vc.stats.find((s) => s.ruleId === rule.id && s.status === status)?._count._all ?? 0;
  const warnings: CommentReplyWarningCode[] = [];
  if (vc.overLimit) warnings.push('OVER_PLAN_LIMIT');
  if (!commentReplySettingsOf(rule.channel.settings).receiving) warnings.push('CHANNEL_NOT_SUBSCRIBED');
  const materialStatus = !rule.material ? 'DELETED' : rule.material.isActive ? 'ACTIVE' : 'INACTIVE';
  if (rule.contentType === 'material' && materialStatus !== 'ACTIVE') warnings.push('MATERIAL_INACTIVE');

  return {
    id: rule.id,
    name: rule.name,
    channelId: rule.channelId,
    channel: {
      id: rule.channel.id,
      channelType: rule.channel.channelType,
      displayName: rule.channel.displayName,
      accountId: rule.channel.externalAccountId,
    },
    keywords: rule.keywords,
    matchMode: rule.matchMode as CommentReplyMatchMode,
    postScope: rule.postScope as CommentReplyPostScope,
    posts: snapshotsOf(rule).map((s) => ({
      postId: s.postId,
      permalink: s.permalink ?? null,
      thumbnailUrl: s.thumbnailUrl ?? null,
      excerpt: s.excerpt ?? null,
      publishedAt: s.publishedAt ?? null,
    })),
    content:
      rule.contentType === 'material'
        ? { type: 'material', materialId: rule.materialId, materialName: rule.material?.name ?? null, materialStatus }
        : { type: 'text', text: rule.messageText ?? '' },
    dedupePerCommenter: rule.dedupePerCommenter,
    publicReply: { enabled: rule.publicReplyEnabled, texts: rule.publicReplyTexts },
    isActive: rule.isActive,
    priority: rule.priority,
    canEdit: canEditChannel(channels, viewer, rule.channelId),
    stats7d: { sent: count('SENT'), failed: count('FAILED'), expired: count('EXPIRED'), duplicate: count('SKIPPED_DUPLICATE') },
    warnings,
  };
}

/** GET /rules：檢視者看得到的渠道的規則（未刪除），依 priority 排序 */
export async function listRules(ctx: TenantCtx, viewer: CommentReplyViewer, filter: { channelId?: string } = {}): Promise<RuleView[]> {
  const channels = await resolveViewerChannels(ctx, viewer);
  const visible = channelIdFilter(channels);
  if (filter.channelId && channelLevel(channels, filter.channelId) === null) return [];
  const rules = await ctx.tx.commentReplyRule.findMany({
    where: {
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...(filter.channelId ? { channelId: filter.channelId } : visible ? { channelId: visible } : {}),
    },
    include: ruleInclude,
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
  const vc = await viewContext(ctx, rules.map((r) => r.id));
  return rules.map((r) => toView(r, viewer, channels, vc));
}

/** 讀一條看得到的規則；看不到、已刪除、其他租戶都回 404 RULE_NOT_FOUND */
async function loadVisibleRule(ctx: TenantCtx, channels: ViewerChannels, id: string): Promise<RuleRow> {
  const rule = await ctx.tx.commentReplyRule.findFirst({ where: { id, tenantId: ctx.tenantId, deletedAt: null }, include: ruleInclude });
  if (!rule || channelLevel(channels, rule.channelId) === null) throw RULE_NOT_FOUND();
  return rule;
}

async function loadEditableRule(ctx: TenantCtx, viewer: CommentReplyViewer, channels: ViewerChannels, id: string): Promise<RuleRow> {
  const rule = await loadVisibleRule(ctx, channels, id);
  if (!canEditChannel(channels, viewer, rule.channelId)) throw CHANNEL_ACCESS_DENIED();
  return rule;
}

export async function getRule(ctx: TenantCtx, viewer: CommentReplyViewer, id: string): Promise<RuleView> {
  const channels = await resolveViewerChannels(ctx, viewer);
  const rule = await loadVisibleRule(ctx, channels, id);
  return toView(rule, viewer, channels, await viewContext(ctx, [rule.id]));
}

async function reloadView(ctx: TenantCtx, viewer: CommentReplyViewer, channels: ViewerChannels, id: string): Promise<RuleView> {
  const rule = await ctx.tx.commentReplyRule.findFirstOrThrow({ where: { id, tenantId: ctx.tenantId }, include: ruleInclude });
  return toView(rule, viewer, channels, await viewContext(ctx, [rule.id]));
}

// ─── 驗證 ────────────────────────────────────────────────────────────────

/** 啟用規則數已達有效上限 → 403 PLAN_LIMIT_EXCEEDED（design「上限檢查點」） */
async function assertActiveRuleCapacity(ctx: TenantCtx): Promise<void> {
  const max = await getEffectiveLimit(ctx.tx, ctx.tenantId, 'maxCommentReplyRules');
  if (max === null) return;
  const current = await countActiveRules(ctx);
  if (current >= max) {
    throw new AppError(`啟用中的留言規則已達方案上限（${max} 條），可以先以停用狀態儲存，或升級方案`, 'PLAN_LIMIT_EXCEEDED', 403, {
      limitKey: 'maxCommentReplyRules',
      current,
      max,
    });
  }
}

interface ValidatedChannel {
  channel: RuleChannel;
  ext: ChannelCommentExtension;
}

/** 渠道：本租戶、檢視者可編輯、外掛有留言擴充 */
async function loadRuleChannel(
  ctx: TenantCtx,
  viewer: CommentReplyViewer,
  channels: ViewerChannels,
  channelId: string,
): Promise<ValidatedChannel> {
  const channel = await ctx.tx.channel.findFirst({ where: { id: channelId, tenantId: ctx.tenantId }, select: channelSelect });
  if (!channel || !channel.isActive) {
    throw new AppError('找不到這個渠道或渠道已停用', 'CHANNEL_NOT_FOUND', 400, { field: 'channelId' });
  }
  if (!canEditChannel(channels, viewer, channel.id)) {
    throw new AppError('你沒有這個渠道的編輯權限', 'CHANNEL_ACCESS_DENIED', 403, { field: 'channelId' });
  }
  const ext = commentExtensionOf(channel.channelType);
  if (!ext) {
    throw new AppError('這個渠道不支援留言自動私訊，請選擇 Facebook 粉專或 Instagram 帳號', 'CHANNEL_NOT_SUPPORTED', 400, { field: 'channelId' });
  }
  return { channel, ext };
}

function assertPrivateReplyCapability(ext: ChannelCommentExtension, settings: CommentReplyPlatformSettings) {
  const cap = capabilityName(ext.capabilities.platform, 'PrivateReply');
  if (!settings.capabilities[cap]) {
    throw new AppError('平台尚未開放這個平台的留言私訊', 'CAPABILITY_DISABLED', 403, { capability: cap, field: 'channelId' });
  }
}

function assertPublicReplyAllowed(ext: ChannelCommentExtension, settings: CommentReplyPlatformSettings, input: RuleInput) {
  if (!input.publicReply.enabled) return;
  if (!ext.capabilities.publicReply) {
    throw new AppError('這個渠道不支援公開回覆留言', 'PUBLIC_REPLY_NOT_SUPPORTED', 400, { field: 'publicReply' });
  }
  const cap = capabilityName(ext.capabilities.platform, 'PublicReply');
  if (!settings.capabilities[cap]) {
    throw new AppError('平台尚未開放公開回覆', 'CAPABILITY_DISABLED', 400, { capability: cap, field: 'publicReply' });
  }
}

/** 指定貼文以外掛 parsePostReference() 正規化（與 webhook 留言事件同格式）；無法辨識 → 400 POST_ID_INVALID */
function normalizePosts(ext: ChannelCommentExtension, channel: RuleChannel, input: RuleInput) {
  if (input.postScope === 'all') return { postIds: [] as string[], snapshots: [] as StoredSnapshot[] };
  const accountId = channelAccountId(channel);
  const postIds: string[] = [];
  const snapshots: StoredSnapshot[] = [];
  input.posts.forEach((post, index) => {
    const postId = ext.parsePostReference(post.postId, { accountId });
    if (!postId) {
      throw new AppError(`第 ${index + 1} 篇貼文的 ID 或網址無法辨識`, 'POST_ID_INVALID', 400, { field: `posts.${index}`, index });
    }
    if (postIds.includes(postId)) return;
    postIds.push(postId);
    snapshots.push({
      postId,
      permalink: post.permalink ?? null,
      thumbnailUrl: post.thumbnailUrl ?? null,
      excerpt: post.excerpt ?? null,
      publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
    });
  });
  return { postIds, snapshots };
}

const COUPON_URL_IN_TEXT = /\{\{\s*coupon\.url\s*\}\}/;

/** 私訊內容符合外掛能力、素材屬於本租戶且啟用中、不含顧客專屬券連結 */
async function validateContent(ctx: TenantCtx, ext: ChannelCommentExtension, input: RuleInput): Promise<void> {
  const couponError = () =>
    new AppError('留言私訊不能使用顧客專屬券連結（{{coupon.url}}）', 'COUPON_URL_IN_RULE_MESSAGE', 400, { field: 'content', variable: COUPON_URL_KEY });
  const unsupported = () => new AppError('這個素材的類型不能用於留言私訊', 'MATERIAL_UNSUPPORTED', 400, { field: 'content' });

  if (input.content.type === 'text') {
    if (!ext.capabilities.privateReplyContentTypes.includes('text')) throw unsupported();
    if (COUPON_URL_IN_TEXT.test(input.content.text)) throw couponError();
    return;
  }
  const materialChannelType = ext.capabilities.materialChannelType;
  if (materialChannelType === null) {
    throw new AppError('這個渠道的留言私訊只能使用文字', 'MATERIAL_UNSUPPORTED', 400, { field: 'content' });
  }
  const material = await ctx.tx.material.findFirst({
    where: { id: input.content.materialId, tenantId: ctx.tenantId },
    select: { id: true, channelType: true, contentType: true, isActive: true, body: true },
  });
  if (!material || !material.isActive) {
    throw new AppError('找不到這個素材或素材已停用', 'MATERIAL_NOT_FOUND', 400, { field: 'content' });
  }
  if (
    material.channelType !== materialChannelType ||
    !ext.capabilities.privateReplyContentTypes.includes(material.contentType) ||
    COMMENT_REPLY_FORBIDDEN_MATERIAL_TYPES.includes(material.contentType)
  ) {
    throw unsupported();
  }
  if (bodyHasCouponUrl(material.body)) throw couponError();
}

function ruleData(input: RuleInput, posts: { postIds: string[]; snapshots: StoredSnapshot[] }) {
  return {
    name: input.name,
    keywords: input.keywords,
    matchMode: input.matchMode,
    postScope: input.postScope,
    postIds: posts.postIds,
    postSnapshots: posts.snapshots as unknown as Prisma.InputJsonValue,
    contentType: input.content.type,
    materialId: input.content.type === 'material' ? input.content.materialId : null,
    messageText: input.content.type === 'text' ? input.content.text : null,
    dedupePerCommenter: input.dedupePerCommenter,
    publicReplyEnabled: input.publicReply.enabled,
    publicReplyTexts: input.publicReply.texts,
    isActive: input.isActive,
  };
}

// ─── 寫入 ────────────────────────────────────────────────────────────────

export interface RuleWriteResult {
  view: RuleView;
  channelId: string;
}

/** POST /rules */
export async function createRule(
  ctx: TenantCtx,
  viewer: CommentReplyViewer,
  input: RuleInput,
  opts: { settings: CommentReplyPlatformSettings },
): Promise<RuleWriteResult> {
  const channels = await resolveViewerChannels(ctx, viewer);
  const { channel, ext } = await loadRuleChannel(ctx, viewer, channels, input.channelId);
  assertPrivateReplyCapability(ext, opts.settings);
  assertPublicReplyAllowed(ext, opts.settings, input);
  const posts = normalizePosts(ext, channel, input);
  await validateContent(ctx, ext, input);
  if (input.isActive) await assertActiveRuleCapacity(ctx);

  const last = await ctx.tx.commentReplyRule.aggregate({ where: { tenantId: ctx.tenantId, deletedAt: null }, _max: { priority: true } });
  const created = await ctx.tx.commentReplyRule.create({
    data: {
      tenantId: ctx.tenantId,
      channelId: channel.id,
      ...ruleData(input, posts),
      priority: (last._max.priority ?? -1) + 1,
      createdById: viewer.agentId,
      updatedById: viewer.agentId,
    },
    select: { id: true },
  });
  return { view: await reloadView(ctx, viewer, channels, created.id), channelId: channel.id };
}

/** 既有規則轉回 RuleInput 的形狀（PATCH 合併用） */
function ruleAsInput(rule: RuleRow): Record<string, unknown> {
  return {
    channelId: rule.channelId,
    name: rule.name,
    keywords: rule.keywords,
    matchMode: rule.matchMode,
    postScope: rule.postScope,
    posts: snapshotsOf(rule).map((s) => ({
      postId: s.postId,
      ...(s.permalink ? { permalink: s.permalink } : {}),
      ...(s.thumbnailUrl ? { thumbnailUrl: s.thumbnailUrl } : {}),
      ...(s.excerpt ? { excerpt: s.excerpt } : {}),
      ...(s.publishedAt ? { publishedAt: s.publishedAt } : {}),
    })),
    content: rule.contentType === 'material' ? { type: 'material', materialId: rule.materialId } : { type: 'text', text: rule.messageText ?? '' },
    dedupePerCommenter: rule.dedupePerCommenter,
    publicReply: { enabled: rule.publicReplyEnabled, texts: rule.publicReplyTexts },
    isActive: rule.isActive,
  };
}

/** PATCH /rules/:id：合併既有值後以 parseRuleInput() 再驗證一次（例如只送 postScope='selected' 而既有沒有貼文） */
export async function updateRule(
  ctx: TenantCtx,
  viewer: CommentReplyViewer,
  id: string,
  patch: RulePatch,
  opts: { settings: CommentReplyPlatformSettings },
): Promise<RuleWriteResult & { changedFields: string[] }> {
  const channels = await resolveViewerChannels(ctx, viewer);
  const rule = await loadEditableRule(ctx, viewer, channels, id);
  const merged = parseRuleInput({ ...ruleAsInput(rule), ...patch });
  const { channel, ext } = await loadRuleChannel(ctx, viewer, channels, rule.channelId);

  if (patch.publicReply !== undefined) assertPublicReplyAllowed(ext, opts.settings, merged);
  const posts = normalizePosts(ext, channel, merged);
  if (patch.content !== undefined) await validateContent(ctx, ext, merged);
  if (merged.isActive && !rule.isActive) await assertActiveRuleCapacity(ctx);

  await ctx.tx.commentReplyRule.update({
    where: { id: rule.id },
    data: { ...ruleData(merged, posts), updatedById: viewer.agentId },
  });
  return { view: await reloadView(ctx, viewer, channels, rule.id), channelId: rule.channelId, changedFields: Object.keys(patch) };
}

/** PATCH /rules/:id/active */
export async function setRuleActive(ctx: TenantCtx, viewer: CommentReplyViewer, id: string, isActive: boolean): Promise<RuleWriteResult> {
  const channels = await resolveViewerChannels(ctx, viewer);
  const rule = await loadEditableRule(ctx, viewer, channels, id);
  if (isActive && !rule.isActive) await assertActiveRuleCapacity(ctx);
  if (rule.isActive !== isActive) {
    await ctx.tx.commentReplyRule.update({ where: { id: rule.id }, data: { isActive, updatedById: viewer.agentId } });
  }
  return { view: await reloadView(ctx, viewer, channels, rule.id), channelId: rule.channelId };
}

/** DELETE /rules/:id：軟刪除（觸發紀錄保留） */
export async function deleteRule(ctx: TenantCtx, viewer: CommentReplyViewer, id: string): Promise<{ id: string; name: string; channelId: string }> {
  const channels = await resolveViewerChannels(ctx, viewer);
  const rule = await loadEditableRule(ctx, viewer, channels, id);
  await ctx.tx.commentReplyRule.update({ where: { id: rule.id }, data: { deletedAt: new Date(), updatedById: viewer.agentId } });
  return { id: rule.id, name: rule.name, channelId: rule.channelId };
}

/**
 * PUT /rules/order：ids 必須恰好是檢視者看得到且可編輯的規則；不一致 409 RULE_ORDER_MISMATCH、順序不變。
 * 看不到的規則維持原本的位置：先把全部規則依目前順序排好，只在可編輯規則佔的位置換成新順序，再重新編號。
 */
export async function reorderRules(ctx: TenantCtx, viewer: CommentReplyViewer, ids: string[]): Promise<{ channelIds: string[] }> {
  const channels = await resolveViewerChannels(ctx, viewer);
  const all = await ctx.tx.commentReplyRule.findMany({
    where: { tenantId: ctx.tenantId, deletedAt: null },
    select: { id: true, channelId: true, priority: true },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
  const editable = all.filter((r) => canEditChannel(channels, viewer, r.channelId));
  const editableIds = new Set(editable.map((r) => r.id));
  if (ids.length !== editableIds.size || !ids.every((id) => editableIds.has(id))) {
    throw new AppError('規則清單已變動，請重新整理後再調整順序', 'RULE_ORDER_MISMATCH', 409, {
      expected: editableIds.size,
      received: ids.length,
    });
  }
  const queue = [...ids];
  const ordered = all.map((r) => (editableIds.has(r.id) ? queue.shift()! : r.id));
  for (let i = 0; i < ordered.length; i++) {
    const current = all.find((r) => r.id === ordered[i])!;
    if (current.priority !== i) await ctx.tx.commentReplyRule.update({ where: { id: ordered[i] }, data: { priority: i } });
  }
  return { channelIds: [...new Set(editable.map((r) => r.channelId))] };
}

// ─── 試算與素材選項 ──────────────────────────────────────────────────────

async function loadVisibleCommentChannel(ctx: TenantCtx, viewer: CommentReplyViewer, channelId: string) {
  const channels = await resolveViewerChannels(ctx, viewer);
  const channel = await ctx.tx.channel.findFirst({ where: { id: channelId, tenantId: ctx.tenantId }, select: channelSelect });
  if (!channel || channelLevel(channels, channel.id) === null) throw new AppError('找不到這個渠道', 'CHANNEL_NOT_FOUND', 404);
  return { channel, ext: commentExtensionOf(channel.channelType) };
}

/** POST /rules/test：與收件相同的規則來源與比對函式，不建立紀錄、不呼叫 Meta */
export async function testRules(
  ctx: TenantCtx,
  viewer: CommentReplyViewer,
  input: { channelId: string; postId?: string; text: string },
): Promise<{ matched: boolean; ruleId?: string; ruleName?: string; matchedKeywords?: string[] }> {
  const { channel, ext } = await loadVisibleCommentChannel(ctx, viewer, input.channelId);
  if (!ext) return { matched: false };
  const postId = input.postId ? (ext.parsePostReference(input.postId, { accountId: channelAccountId(channel) }) ?? input.postId) : '';
  const rules = await listActiveRulesForChannel(ctx, channel.id);
  const hit = matchCommentRule(
    rules.map((r) => ({ ...r, matchMode: r.matchMode as CommentReplyMatchMode, postScope: r.postScope as CommentReplyPostScope })),
    { channelId: channel.id, postId, text: input.text },
  );
  if (!hit) return { matched: false };
  return { matched: true, ruleId: hit.rule.id, ruleName: hit.rule.name, matchedKeywords: hit.matchedKeywords };
}

function materialPreview(body: unknown, fallback: string): string {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const text = [b.text, b.altText, b.title, b.caption].find((v) => typeof v === 'string' && v.trim() !== '') as string | undefined;
  return (text ?? fallback).slice(0, 100);
}

/** GET /material-options：該渠道外掛可用於私訊、啟用中的本租戶素材摘要（不需要 marketing.view，design D20） */
export async function listMaterialOptions(
  ctx: TenantCtx,
  viewer: CommentReplyViewer,
  channelId: string,
): Promise<Array<{ id: string; name: string; contentType: string; preview: string }>> {
  const { ext } = await loadVisibleCommentChannel(ctx, viewer, channelId);
  const materialChannelType = ext?.capabilities.materialChannelType ?? null;
  if (!ext || materialChannelType === null) return [];
  const types = ext.capabilities.privateReplyContentTypes.filter((t) => !COMMENT_REPLY_FORBIDDEN_MATERIAL_TYPES.includes(t));
  const materials = await ctx.tx.material.findMany({
    where: { tenantId: ctx.tenantId, isActive: true, channelType: materialChannelType, contentType: { in: [...types] } },
    select: { id: true, name: true, contentType: true, body: true },
    orderBy: [{ updatedAt: 'desc' }],
    take: 500,
  });
  return materials
    .filter((m) => !bodyHasCouponUrl(m.body))
    .map((m) => ({ id: m.id, name: m.name, contentType: m.contentType, preview: materialPreview(m.body, m.name) }));
}

/** 留言規則異動時讓收件端的規則快取失效（design D4：程序內快取 30 秒，以 Redis 版本號失效） */
export const commentReplyRulesVersionKey = (channelId: string) => `cr:rules-ver:${channelId}`;
