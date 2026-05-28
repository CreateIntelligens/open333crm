/**
 * Rich Menu 管理 service
 *
 * CRUD：status 一律 draft；published 的 menu 不能直接改 / 刪，需先 unpublish。
 * Publish 流程：建 LINE richmenu → 上傳圖 → 若 selected 則 set as default。
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../../shared/utils/response.js';
import { logger } from '@open333crm/core';
import { isValidRichMenuSize } from './rich-menu.layouts.js';
import { decryptCredentials } from '../channel/channel.service.js';

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
  selected?: boolean;
  areas: RichMenuArea[];
  imageUrl: string;
}

export interface UpdateRichMenuInput {
  name?: string;
  chatBarText?: string;
  size?: { width: number; height: number };
  selected?: boolean;
  areas?: RichMenuArea[];
  imageUrl?: string;
}

// ─── Validation helpers ────────────────────────────────────────────────

function validateChatBarText(text: string): void {
  if (text.length === 0) throw new AppError('chatBarText is required', 'INVALID_INPUT', 400);
  if (text.length > 14) throw new AppError('chatBarText must be at most 14 characters', 'INVALID_INPUT', 400);
}

function validateAction(action: RichMenuAction): void {
  if (!action || !action.type) {
    throw new AppError('Action type is required', 'INVALID_ACTION', 400);
  }
  switch (action.type) {
    case 'postback':
      if (!action.data) throw new AppError('postback action requires data', 'INVALID_ACTION', 400);
      if (action.data.length > 300) throw new AppError('postback data ≤ 300 chars', 'INVALID_ACTION', 400);
      if (action.label && action.label.length > 20) throw new AppError('label ≤ 20 chars', 'INVALID_ACTION', 400);
      if (action.displayText && action.displayText.length > 300) throw new AppError('displayText ≤ 300 chars', 'INVALID_ACTION', 400);
      break;
    case 'message':
      if (!action.text) throw new AppError('message action requires text', 'INVALID_ACTION', 400);
      if (action.text.length > 300) throw new AppError('message text ≤ 300 chars', 'INVALID_ACTION', 400);
      break;
    case 'uri':
      if (!action.uri) throw new AppError('uri action requires uri', 'INVALID_ACTION', 400);
      break;
    case 'datetimepicker':
      if (!action.data) throw new AppError('datetimepicker requires data', 'INVALID_ACTION', 400);
      if (!action.mode) throw new AppError('datetimepicker requires mode', 'INVALID_ACTION', 400);
      if (!['date', 'time', 'datetime'].includes(action.mode)) {
        throw new AppError('datetimepicker mode must be date/time/datetime', 'INVALID_ACTION', 400);
      }
      break;
    case 'richmenuswitch':
      if (!action.richMenuAliasId) throw new AppError('richmenuswitch requires richMenuAliasId', 'INVALID_ACTION', 400);
      if (!action.data) throw new AppError('richmenuswitch requires data', 'INVALID_ACTION', 400);
      break;
    default:
      throw new AppError(`Unsupported action type: ${(action as { type: string }).type}`, 'INVALID_ACTION', 400);
  }
}

function validateAreas(areas: RichMenuArea[], size: { width: number; height: number }): void {
  if (!Array.isArray(areas) || areas.length === 0) {
    throw new AppError('At least one area is required', 'INVALID_INPUT', 400);
  }
  if (areas.length > 20) {
    throw new AppError('Up to 20 areas allowed', 'INVALID_INPUT', 400);
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

async function assertChannelBelongsToTenant(
  prisma: PrismaClient,
  channelId: string,
  tenantId: string,
): Promise<void> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, tenantId },
  });
  if (!channel) {
    // 不洩露 channel 存在性，回 404
    throw new AppError('Channel not found', 'NOT_FOUND', 404);
  }
  if (channel.channelType !== 'LINE') {
    throw new AppError('Rich Menu is only supported on LINE channels', 'INVALID_CHANNEL_TYPE', 400);
  }
}

// ─── CRUD ──────────────────────────────────────────────────────────────

export async function listRichMenus(
  prisma: PrismaClient,
  tenantId: string,
  channelId: string,
) {
  await assertChannelBelongsToTenant(prisma, channelId, tenantId);
  return prisma.richMenu.findMany({
    where: { tenantId, channelId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getRichMenu(
  prisma: PrismaClient,
  id: string,
  tenantId: string,
) {
  const menu = await prisma.richMenu.findFirst({ where: { id, tenantId } });
  if (!menu) throw new AppError('Rich Menu not found', 'NOT_FOUND', 404);
  return menu;
}

export async function createRichMenu(
  prisma: PrismaClient,
  tenantId: string,
  input: CreateRichMenuInput,
) {
  await assertChannelBelongsToTenant(prisma, input.channelId, tenantId);
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
    throw new AppError('imageUrl is required', 'INVALID_INPUT', 400);
  }

  return prisma.richMenu.create({
    data: {
      tenantId,
      channelId: input.channelId,
      name: input.name,
      chatBarText: input.chatBarText,
      size: input.size as unknown as Prisma.InputJsonValue,
      selected: input.selected ?? false,
      areas: input.areas as unknown as Prisma.InputJsonValue,
      imageUrl: input.imageUrl,
      status: 'draft',
    },
  });
}

export async function updateRichMenu(
  prisma: PrismaClient,
  id: string,
  tenantId: string,
  input: UpdateRichMenuInput,
) {
  const existing = await getRichMenu(prisma, id, tenantId);

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
    throw new AppError('Invalid layout size', 'INVALID_LAYOUT', 400);
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
  if (input.areas !== undefined) data.areas = input.areas as unknown as Prisma.InputJsonValue;
  if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl;

  return prisma.richMenu.update({ where: { id }, data });
}

export async function deleteRichMenu(
  prisma: PrismaClient,
  id: string,
  tenantId: string,
) {
  const existing = await getRichMenu(prisma, id, tenantId);
  if (existing.status !== 'draft') {
    throw new AppError(
      '已發布的 Rich Menu 不能直接刪除，請先取消發布',
      'CANNOT_DELETE_PUBLISHED',
      400,
    );
  }
  await prisma.richMenu.delete({ where: { id } });
  return { deleted: true };
}

export async function duplicateRichMenu(
  prisma: PrismaClient,
  id: string,
  tenantId: string,
) {
  const source = await getRichMenu(prisma, id, tenantId);
  return prisma.richMenu.create({
    data: {
      tenantId,
      channelId: source.channelId,
      name: `${source.name}（副本）`,
      chatBarText: source.chatBarText,
      size: source.size as unknown as Prisma.InputJsonValue,
      selected: source.selected,
      areas: source.areas as unknown as Prisma.InputJsonValue,
      imageUrl: source.imageUrl,
      status: 'draft',
    },
  });
}

// ─── Publish / Unpublish ───────────────────────────────────────────────

const LINE_API_BASE = 'https://api.line.me';
const LINE_DATA_API_BASE = 'https://api-data.line.me';
const MAX_IMAGE_BYTES = 1024 * 1024; // 1 MB

async function getLineAccessToken(
  prisma: PrismaClient,
  channelId: string,
  tenantId: string,
): Promise<string> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, tenantId, channelType: 'LINE' },
  });
  if (!channel) {
    throw new AppError('LINE channel not found', 'NOT_FOUND', 404);
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

interface FetchedImage {
  buffer: Buffer;
  contentType: 'image/jpeg' | 'image/png';
}

async function fetchAndValidateImage(
  imageUrl: string,
  size: { width: number; height: number },
): Promise<FetchedImage> {
  let response: Response;
  try {
    response = await fetch(imageUrl);
  } catch {
    throw new AppError(`無法取得背景圖：${imageUrl}`, 'IMAGE_FETCH_FAILED', 400);
  }
  if (!response.ok) {
    throw new AppError(
      `背景圖回應 ${response.status}：${imageUrl}`,
      'IMAGE_FETCH_FAILED',
      400,
    );
  }

  const contentTypeHeader = (response.headers.get('content-type') ?? '').toLowerCase();
  let contentType: 'image/jpeg' | 'image/png';
  if (contentTypeHeader.includes('image/jpeg') || contentTypeHeader.includes('image/jpg')) {
    contentType = 'image/jpeg';
  } else if (contentTypeHeader.includes('image/png')) {
    contentType = 'image/png';
  } else {
    throw new AppError(
      `背景圖格式必須是 JPEG 或 PNG（實際：${contentTypeHeader || 'unknown'}）`,
      'IMAGE_INVALID_TYPE',
      400,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new AppError(
      `背景圖大小 ${(buffer.byteLength / 1024).toFixed(0)}KB 超過 LINE 限制 1MB`,
      'IMAGE_TOO_LARGE',
      400,
    );
  }
  // 註：尺寸（寬高 pixel）由 LINE API 拒絕回報，本地不解析 PNG/JPEG header；
  // size 欄位已在 create/update 時驗過版型合法，這裡只擋大小與 MIME。
  void size;

  return { buffer, contentType };
}

/**
 * 把現行所有 selected=true 的 published rich menu 取消 default。
 * LINE 端的「全體 default richmenu」只能有一個；新 publish selected=true
 * 時要先讓出位置，避免 set default 時與舊的衝突。
 */
async function unsetCurrentDefault(
  prisma: PrismaClient,
  tenantId: string,
  channelId: string,
  accessToken: string,
  excludeId: string,
): Promise<void> {
  const others = await prisma.richMenu.findMany({
    where: {
      tenantId,
      channelId,
      status: 'published',
      selected: true,
      NOT: { id: excludeId },
      lineRichMenuId: { not: null },
    },
  });
  if (others.length === 0) return;

  // LINE 沒有 per-richmenu 取消 default 的 API；直接呼叫 DELETE all default
  try {
    await fetch(`${LINE_API_BASE}/v2/bot/user/all/richmenu`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    logger.warn(`[RichMenu] unset default failed: ${(err as Error).message}`);
  }

  await prisma.richMenu.updateMany({
    where: { id: { in: others.map((o) => o.id) } },
    data: { selected: false },
  });
}

export async function publishRichMenu(
  prisma: PrismaClient,
  id: string,
  tenantId: string,
) {
  const menu = await getRichMenu(prisma, id, tenantId);
  if (menu.status === 'published') {
    throw new AppError('此 Rich Menu 已發布', 'ALREADY_PUBLISHED', 400);
  }

  const accessToken = await getLineAccessToken(prisma, menu.channelId, tenantId);
  const size = menu.size as unknown as { width: number; height: number };
  const image = await fetchAndValidateImage(menu.imageUrl, size);

  // 1. 建立 richmenu
  const createResp = await fetch(`${LINE_API_BASE}/v2/bot/richmenu`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      size,
      selected: menu.selected,
      name: menu.name,
      chatBarText: menu.chatBarText,
      areas: menu.areas,
    }),
  });
  if (!createResp.ok) {
    const body = await createResp.text();
    await prisma.richMenu.update({ where: { id }, data: { status: 'error' } });
    throw new AppError(
      `LINE 建立 Rich Menu 失敗 (${createResp.status}): ${body}`,
      'LINE_API_ERROR',
      400,
    );
  }
  const { richMenuId } = (await createResp.json()) as { richMenuId: string };

  // 2. 上傳背景圖
  const uploadResp = await fetch(
    `${LINE_DATA_API_BASE}/v2/bot/richmenu/${richMenuId}/content`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': image.contentType,
      },
      body: image.buffer,
    },
  );
  if (!uploadResp.ok) {
    const body = await uploadResp.text();
    // 回滾：刪掉剛建的 richmenu，避免殘留
    await fetch(`${LINE_API_BASE}/v2/bot/richmenu/${richMenuId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => {});
    await prisma.richMenu.update({ where: { id }, data: { status: 'error' } });
    throw new AppError(
      `LINE 上傳背景圖失敗 (${uploadResp.status}): ${body}`,
      'LINE_API_ERROR',
      400,
    );
  }

  // 3. 設為 default（若 selected）
  if (menu.selected) {
    await unsetCurrentDefault(prisma, tenantId, menu.channelId, accessToken, id);

    const defaultResp = await fetch(
      `${LINE_API_BASE}/v2/bot/user/all/richmenu/${richMenuId}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!defaultResp.ok) {
      const body = await defaultResp.text();
      logger.warn(`[RichMenu] set default failed: ${defaultResp.status} ${body}`);
      // 不算致命 — richmenu 已建好，使用者可從 LINE OA 後台手動設 default
    }
  }

  const updated = await prisma.richMenu.update({
    where: { id },
    data: {
      status: 'published',
      lineRichMenuId: richMenuId,
      publishedAt: new Date(),
    },
  });
  logger.info(`[RichMenu] published id=${id} lineRichMenuId=${richMenuId}`);
  return updated;
}

export async function unpublishRichMenu(
  prisma: PrismaClient,
  id: string,
  tenantId: string,
) {
  const menu = await getRichMenu(prisma, id, tenantId);
  if (menu.status !== 'published' && menu.status !== 'error') {
    throw new AppError('此 Rich Menu 尚未發布', 'NOT_PUBLISHED', 400);
  }

  const accessToken = await getLineAccessToken(prisma, menu.channelId, tenantId);

  if (menu.lineRichMenuId) {
    // 若是 default，先 unset default（避免 LINE 端孤兒指向）
    if (menu.selected) {
      await fetch(`${LINE_API_BASE}/v2/bot/user/all/richmenu`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch((err) => {
        logger.warn(`[RichMenu] unset default failed during unpublish: ${(err as Error).message}`);
      });
    }

    const deleteResp = await fetch(
      `${LINE_API_BASE}/v2/bot/richmenu/${menu.lineRichMenuId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    // 404 視為已不存在，可繼續清本地狀態
    if (!deleteResp.ok && deleteResp.status !== 404) {
      const body = await deleteResp.text();
      throw new AppError(
        `LINE 刪除 Rich Menu 失敗 (${deleteResp.status}): ${body}`,
        'LINE_API_ERROR',
        400,
      );
    }
  }

  const updated = await prisma.richMenu.update({
    where: { id },
    data: {
      status: 'draft',
      lineRichMenuId: null,
      publishedAt: null,
    },
  });
  logger.info(`[RichMenu] unpublished id=${id}`);
  return updated;
}
