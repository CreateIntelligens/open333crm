/**
 * Rich Menu 管理 service
 *
 * CRUD：status 一律 draft；published 的 menu 不能直接改 / 刪，需先 unpublish。
 * 每個函式在呼叫端（rich-menu.flow.ts）開的租戶交易內執行，不呼叫 LINE（AGENTS.md 結構規則 2）。
 * 發布、取消發布的 LINE 呼叫在 rich-menu.line-api.ts，由 flow 在交易外呼叫。
 */

import type { Prisma } from '@prisma/client';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { AppError } from '../../shared/utils/response.js';
import { isValidRichMenuSize } from './rich-menu.layouts.js';
import { decryptCredentials } from '../channel/channel.service.js';
import { calculateSegmentContacts } from '../marketing/segment.service.js';
import { notFound } from '../../shared/messages/resource.js';
import { ALL_CHANNELS } from '../../services/channel-visibility.js';

/** Rich Menu 分眾綁定的背景 queue（與 apps/workers 端消費者一致）。 */
export const RICH_MENU_BIND_QUEUE = 'rich-menu-bind';

// ─── Types ─────────────────────────────────────────────────────────────

type ActionType = 'postback' | 'message' | 'uri' | 'datetimepicker' | 'richmenuswitch';

interface RichMenuAction {
  type: ActionType;
  // 共用欄位
  label?: string;
  // postback
  data?: string;
  displayText?: string;
  // message
  text?: string;
  // uri
  uri?: string;
  altUri?: { desktop?: string };
  // datetimepicker
  mode?: 'date' | 'time' | 'datetime';
  initial?: string;
  min?: string;
  max?: string;
  // richmenuswitch
  richMenuAliasId?: string;
}

interface RichMenuArea {
  bounds: { x: number; y: number; width: number; height: number };
  action: RichMenuAction;
}

export interface CreateRichMenuInput {
  channelId: string;
  name: string;
  chatBarText: string;
  size: { width: number; height: number };
  /** 聊天室打開時是否展開選單（LINE 的 selected） */
  selected?: boolean;
  /** 是否為所有好友的預設選單 */
  isDefault?: boolean;
  areas: RichMenuArea[];
  imageUrl: string;
}

export interface UpdateRichMenuInput {
  name?: string;
  chatBarText?: string;
  size?: { width: number; height: number };
  /** 聊天室打開時是否展開選單（LINE 的 selected） */
  selected?: boolean;
  /** 是否為所有好友的預設選單 */
  isDefault?: boolean;
  areas?: RichMenuArea[];
  imageUrl?: string;
}

// ─── Validation helpers ────────────────────────────────────────────────

function validateChatBarText(text: string): void {
  if (text.length === 0) throw new AppError('請填寫聊天列文字', 'INVALID_INPUT', 400);
  if (text.length > 14) throw new AppError('聊天列文字最多 14 個字', 'INVALID_INPUT', 400);
}

function validateAction(action: RichMenuAction): void {
  if (!action || !action.type) {
    throw new AppError('請選擇動作類型', 'INVALID_ACTION', 400);
  }
  switch (action.type) {
    case 'postback':
      if (!action.data) throw new AppError('postback 動作必須填寫資料', 'INVALID_ACTION', 400);
      if (action.data.length > 300) throw new AppError('postback 資料最多 300 個字', 'INVALID_ACTION', 400);
      if (action.label && action.label.length > 20) throw new AppError('標籤文字最多 20 個字', 'INVALID_ACTION', 400);
      if (action.displayText && action.displayText.length > 300) throw new AppError('顯示文字最多 300 個字', 'INVALID_ACTION', 400);
      break;
    case 'message':
      if (!action.text) throw new AppError('message 動作必須填寫訊息內容', 'INVALID_ACTION', 400);
      if (action.text.length > 300) throw new AppError('訊息內容最多 300 個字', 'INVALID_ACTION', 400);
      break;
    case 'uri':
      if (!action.uri) throw new AppError('uri 動作必須填寫連結網址', 'INVALID_ACTION', 400);
      break;
    case 'datetimepicker':
      if (!action.data) throw new AppError('日期選擇器必須填寫資料', 'INVALID_ACTION', 400);
      if (!action.mode) throw new AppError('日期選擇器必須指定模式', 'INVALID_ACTION', 400);
      if (!['date', 'time', 'datetime'].includes(action.mode)) {
        throw new AppError('日期選擇器模式必須是 date、time 或 datetime', 'INVALID_ACTION', 400);
      }
      break;
    case 'richmenuswitch':
      if (!action.richMenuAliasId) throw new AppError('選單切換必須指定目標選單別名', 'INVALID_ACTION', 400);
      if (!action.data) throw new AppError('選單切換必須填寫資料', 'INVALID_ACTION', 400);
      break;
    default:
      throw new AppError(`Unsupported action type: ${(action as { type: string }).type}`, 'INVALID_ACTION', 400);
  }
}

function validateAreas(areas: RichMenuArea[], size: { width: number; height: number }): void {
  if (!Array.isArray(areas) || areas.length === 0) {
    throw new AppError('至少需要設定一個區塊', 'INVALID_INPUT', 400);
  }
  if (areas.length > 20) {
    throw new AppError('最多只能設定 20 個區塊', 'INVALID_INPUT', 400);
  }
  for (const [i, area] of areas.entries()) {
    if (!area.bounds || typeof area.bounds.x !== 'number' || typeof area.bounds.y !== 'number'
      || typeof area.bounds.width !== 'number' || typeof area.bounds.height !== 'number') {
      throw new AppError(`Area #${i + 1} bounds malformed`, 'INVALID_INPUT', 400);
    }
    const { x, y, width, height } = area.bounds;
    if (x < 0 || y < 0 || width <= 0 || height <= 0) {
      throw new AppError(`Area #${i + 1} bounds must be positive`, 'INVALID_INPUT', 400);
    }
    if (x + width > size.width || y + height > size.height) {
      throw new AppError(`Area #${i + 1} exceeds image size`, 'INVALID_INPUT', 400);
    }
    validateAction(area.action);
  }
}

async function assertChannelBelongsToTenant(ctx: TenantCtx, channelId: string): Promise<void> {
  const channel = await ctx.tx.channel.findFirst({
    where: { id: channelId, tenantId: ctx.tenantId },
  });
  if (!channel) {
    // 不洩露 channel 存在性，回 404
    throw new AppError(notFound('channel'), 'NOT_FOUND', 404);
  }
  if (channel.channelType !== 'LINE') {
    throw new AppError('圖文選單僅支援 LINE 渠道', 'INVALID_CHANNEL_TYPE', 400);
  }
}

// ─── CRUD ──────────────────────────────────────────────────────────────

export async function listRichMenus(ctx: TenantCtx, channelId: string) {
  await assertChannelBelongsToTenant(ctx, channelId);
  return ctx.tx.richMenu.findMany({
    where: { tenantId: ctx.tenantId, channelId },
    orderBy: { createdAt: 'desc' },
  });
}

async function findRichMenu(db: Prisma.TransactionClient, id: string, tenantId: string) {
  const menu = await db.richMenu.findFirst({ where: { id, tenantId } });
  if (!menu) throw new AppError(notFound('richMenu'), 'NOT_FOUND', 404);
  return menu;
}

export async function getRichMenu(ctx: TenantCtx, id: string) {
  return findRichMenu(ctx.tx, id, ctx.tenantId);
}

export async function createRichMenu(ctx: TenantCtx, input: CreateRichMenuInput) {
  await assertChannelBelongsToTenant(ctx, input.channelId);
  validateChatBarText(input.chatBarText);

  if (!isValidRichMenuSize(input.size)) {
    throw new AppError(
      'Invalid layout size; must be 2500×1686 or 2500×843',
      'INVALID_LAYOUT',
      400,
    );
  }
  validateAreas(input.areas, input.size);

  if (!input.imageUrl) {
    throw new AppError('請提供圖片網址', 'INVALID_INPUT', 400);
  }

  return ctx.tx.richMenu.create({
    data: {
      tenantId: ctx.tenantId,
      channelId: input.channelId,
      name: input.name,
      chatBarText: input.chatBarText,
      size: input.size as unknown as Prisma.InputJsonValue,
      selected: input.selected ?? true,
      isDefault: input.isDefault ?? false,
      areas: input.areas as unknown as Prisma.InputJsonValue,
      imageUrl: input.imageUrl,
      status: 'draft',
    },
  });
}

export async function updateRichMenu(ctx: TenantCtx, id: string, input: UpdateRichMenuInput) {
  const existing = await getRichMenu(ctx, id);

  // 守衛：已發布的 menu 需先 unpublish 才能修改
  if (existing.status !== 'draft') {
    throw new AppError(
      '已發布的 Rich Menu 不能直接修改，請先取消發布',
      'CANNOT_UPDATE_PUBLISHED',
      400,
    );
  }

  // 取出新或舊的 size，用於驗證 areas
  const finalSize = (input.size ?? (existing.size as { width: number; height: number }));
  if (input.size && !isValidRichMenuSize(input.size)) {
    throw new AppError('版面尺寸不正確', 'INVALID_LAYOUT', 400);
  }
  if (input.areas) {
    validateAreas(input.areas, finalSize);
  }
  if (input.chatBarText !== undefined) {
    validateChatBarText(input.chatBarText);
  }

  const data: Prisma.RichMenuUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.chatBarText !== undefined) data.chatBarText = input.chatBarText;
  if (input.size !== undefined) data.size = input.size as unknown as Prisma.InputJsonValue;
  if (input.selected !== undefined) data.selected = input.selected;
  if (input.isDefault !== undefined) data.isDefault = input.isDefault;
  if (input.areas !== undefined) data.areas = input.areas as unknown as Prisma.InputJsonValue;
  if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl;

  return ctx.tx.richMenu.update({ where: { id }, data });
}

export async function deleteRichMenu(ctx: TenantCtx, id: string) {
  const existing = await getRichMenu(ctx, id);
  if (existing.status !== 'draft') {
    throw new AppError(
      '已發布的 Rich Menu 不能直接刪除，請先取消發布',
      'CANNOT_DELETE_PUBLISHED',
      400,
    );
  }
  await ctx.tx.richMenu.delete({ where: { id } });
  return { deleted: true };
}

export async function duplicateRichMenu(ctx: TenantCtx, id: string) {
  const source = await getRichMenu(ctx, id);
  return ctx.tx.richMenu.create({
    data: {
      tenantId: ctx.tenantId,
      channelId: source.channelId,
      name: `${source.name}（副本）`,
      chatBarText: source.chatBarText,
      size: source.size as unknown as Prisma.InputJsonValue,
      selected: source.selected,
      isDefault: source.isDefault,
      areas: source.areas as unknown as Prisma.InputJsonValue,
      imageUrl: source.imageUrl,
      status: 'draft',
    },
  });
}

// ─── Publish / Unpublish ───────────────────────────────────────────────

/** 停在 publishing 超過這個時間，視為發布中斷，可以重新發布（design D3） */
export const STALE_PUBLISHING_MS = 5 * 60_000;

async function getLineAccessToken(
  prisma: Prisma.TransactionClient,
  channelId: string,
  tenantId: string,
): Promise<string> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, tenantId, channelType: 'LINE' },
  });
  if (!channel) {
    throw new AppError(notFound('lineChannel'), 'NOT_FOUND', 404);
  }
  const credentials = decryptCredentials(channel.credentialsEncrypted);
  const accessToken = credentials.channelAccessToken as string | undefined;
  if (!accessToken) {
    throw new AppError(
      '此 LINE 頻道缺少 channelAccessToken，請先到頻道設定填入',
      'MISSING_ACCESS_TOKEN',
      400,
    );
  }
  return accessToken;
}

/**
 * 同一個渠道的發布依序認領：檢查「渠道沒有其他發布中的選單」與認領在同一把鎖內（design D1）。
 * 交易級 advisory lock，交易結束自動釋放，所以呼叫 LINE 期間不佔鎖。
 */
async function lockChannelPublishing(tx: Prisma.TransactionClient, channelId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`rich-menu-publish:${channelId}`}, 0))`;
}

export interface PublishClaim {
  menu: Awaited<ReturnType<typeof findRichMenu>>;
  accessToken: string;
  /** 發布前同渠道的預設選單在 LINE 端的 id；補償時把預設設回這個選單 */
  previousDefaultLineId: string | null;
}

/**
 * 交易 1：把選單認領成 publishing。draft、error，或停在 publishing 超過 5 分鐘的選單可以認領。
 * 已發布回 400 ALREADY_PUBLISHED；選單或同渠道其他選單發布中回 409 PUBLISH_IN_PROGRESS。
 */
export async function claimRichMenuForPublish(ctx: TenantCtx, id: string): Promise<PublishClaim> {
  const menu = await getRichMenu(ctx, id);
  await lockChannelPublishing(ctx.tx, menu.channelId);
  if (menu.status === 'published') {
    throw new AppError('此 Rich Menu 已發布', 'ALREADY_PUBLISHED', 400);
  }

  const staleBefore = new Date(Date.now() - STALE_PUBLISHING_MS);
  const busy = await ctx.tx.richMenu.count({
    where: {
      tenantId: ctx.tenantId,
      channelId: menu.channelId,
      status: 'publishing',
      updatedAt: { gte: staleBefore },
      NOT: { id },
    },
  });
  const { count } = busy
    ? { count: 0 }
    : await ctx.tx.richMenu.updateMany({
        where: {
          id,
          tenantId: ctx.tenantId,
          OR: [{ status: { in: ['draft', 'error'] } }, { status: 'publishing', updatedAt: { lt: staleBefore } }],
        },
        data: { status: 'publishing' },
      });
  if (count === 0) {
    throw new AppError('這個 LINE 渠道有圖文選單正在發布，請稍後再試', 'PUBLISH_IN_PROGRESS', 409);
  }

  const accessToken = await getLineAccessToken(ctx.tx, menu.channelId, ctx.tenantId);
  const previousDefault = await ctx.tx.richMenu.findFirst({
    where: { tenantId: ctx.tenantId, channelId: menu.channelId, status: 'published', isDefault: true, NOT: { id } },
  });
  return { menu, accessToken, previousDefaultLineId: previousDefault?.lineRichMenuId ?? null };
}

/**
 * 交易 2：寫入發布結果。選單已不是 publishing（中斷後被重新認領）時回 null，呼叫端要補償。
 * isDefault 是 LINE 設預設的結果；成功時同渠道其他已發布的選單不再是預設。
 */
export async function completeRichMenuPublish(
  ctx: TenantCtx,
  id: string,
  result: { lineRichMenuId: string; isDefault: boolean },
) {
  const { count } = await ctx.tx.richMenu.updateMany({
    where: { id, tenantId: ctx.tenantId, status: 'publishing' },
    data: { status: 'published', lineRichMenuId: result.lineRichMenuId, publishedAt: new Date(), isDefault: result.isDefault },
  });
  if (count === 0) return null;

  const menu = await getRichMenu(ctx, id);
  if (result.isDefault) {
    // 只清已發布的選單；草稿的 isDefault 是「發布時設成預設」的設定，不動
    await ctx.tx.richMenu.updateMany({
      where: { tenantId: ctx.tenantId, channelId: menu.channelId, status: 'published', isDefault: true, NOT: { id } },
      data: { isDefault: false },
    });
  }
  return menu;
}

/** 發布失敗時放掉認領：還沒呼叫 LINE 時回到原本的狀態，之後失敗一律是 error */
export async function releaseRichMenuPublish(ctx: TenantCtx, id: string, status: string) {
  await ctx.tx.richMenu.updateMany({
    where: { id, tenantId: ctx.tenantId, status: 'publishing' },
    data: { status, lineRichMenuId: null },
  });
}

/** 取消發布的交易 1：讀選單與憑證。只有 published、error 可以取消發布 */
export async function readRichMenuForUnpublish(ctx: TenantCtx, id: string) {
  const menu = await getRichMenu(ctx, id);
  if (menu.status !== 'published' && menu.status !== 'error') {
    throw new AppError('此 Rich Menu 尚未發布', 'NOT_PUBLISHED', 400);
  }
  const accessToken = await getLineAccessToken(ctx.tx, menu.channelId, ctx.tenantId);
  return { menu, accessToken };
}

/**
 * 取消發布的交易 2：寫回 draft。條件含交易 1 讀到的 LINE 端 id，另一個請求已經寫回時不重寫。
 * isDefault 保留：草稿的 isDefault 是「發布時設成預設」的設定。
 */
export async function completeRichMenuUnpublish(ctx: TenantCtx, id: string, lineRichMenuId: string | null) {
  await ctx.tx.richMenu.updateMany({
    where: { id, tenantId: ctx.tenantId, status: { in: ['published', 'error'] }, lineRichMenuId },
    data: { status: 'draft', lineRichMenuId: null, publishedAt: null },
  });
  return getRichMenu(ctx, id);
}

// ─── 分眾綁定 ───────────────────────────────────────────────────────────

/**
 * 解析受眾（segment 或 tag）成該 channel 的 LINE uid 清單（去重）。
 * segment → calculateSegmentContacts；tag → 直接篩 contactTag。再經 ChannelIdentity 取 LINE uid。
 */
async function resolveAudienceLineUids(
  prisma: Prisma.TransactionClient,
  tenantId: string,
  channelId: string,
  audience: { segmentId?: string; tagId?: string },
): Promise<string[]> {
  let contactIds: string[] = [];

  if (audience.segmentId) {
    const segment = await prisma.segment.findFirst({
      where: { id: audience.segmentId, tenantId },
    });
    if (!segment) throw new AppError('受眾分群不存在', 'SEGMENT_NOT_FOUND', 404);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await calculateSegmentContacts(prisma, tenantId, segment.rules as any, ALL_CHANNELS);
    contactIds = res.contactIds;
  } else if (audience.tagId) {
    const rows = await prisma.contactTag.findMany({
      where: { tagId: audience.tagId, contact: { tenantId } },
      select: { contactId: true },
    });
    contactIds = [...new Set(rows.map((r) => r.contactId))];
  } else {
    throw new AppError('需指定 segmentId 或 tagId', 'AUDIENCE_REQUIRED', 400);
  }

  if (contactIds.length === 0) return [];

  // contactIds → 該 channel 的 LINE uid（去重）。
  // 租戶隔離已由 contactIds（前面經 tenantId 篩）+ channelId（本租戶 menu 的 channel）保證；
  // ChannelIdentity 本身無 tenantId 欄位，靠這兩個外鍵即足夠。
  const identities = await prisma.channelIdentity.findMany({
    where: { contactId: { in: contactIds }, channelType: 'LINE', channelId },
    select: { uid: true },
  });
  return [...new Set(identities.map((i) => i.uid))];
}

export type RichMenuAudience = { segmentId?: string; tagId?: string };

/** rich-menu-bind 佇列的工作內容。richMenuId 讓 workers 執行前確認選單仍已發布（design D6） */
export interface RichMenuBindJobData {
  tenantId: string;
  channelId: string;
  richMenuId: string;
  lineRichMenuId: string | null;
  uids: string[];
  op: 'link' | 'unlink';
}

/** queue-monitoring「各佇列 job 的保留期限」：completed 保留 24 小時，failed 保留 7 天 */
export const RICH_MENU_BIND_JOB_OPTIONS = {
  removeOnComplete: { age: 86_400 },
  removeOnFail: { age: 604_800 },
};

/**
 * 準備綁定或解除綁定的工作：解析受眾的 LINE uid。受眾沒有 LINE 身分時回 null。
 * 綁定只允許已發布的選單；解除綁定不檢查（客人回到全體預設選單）。
 */
export async function prepareRichMenuBindJob(
  ctx: TenantCtx,
  id: string,
  audience: RichMenuAudience,
  op: 'link' | 'unlink',
): Promise<RichMenuBindJobData | null> {
  const menu = await getRichMenu(ctx, id);
  if (op === 'link' && (menu.status !== 'published' || !menu.lineRichMenuId)) {
    throw new AppError('請先發布此 Rich Menu 才能綁定受眾', 'NOT_PUBLISHED', 400);
  }
  const uids = await resolveAudienceLineUids(ctx.tx, ctx.tenantId, menu.channelId, audience);
  if (uids.length === 0) return null;
  return {
    tenantId: ctx.tenantId,
    channelId: menu.channelId,
    richMenuId: id,
    lineRichMenuId: menu.lineRichMenuId,
    uids,
    op,
  };
}
