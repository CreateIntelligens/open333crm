import type { PrismaClient } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import type { Server as SocketIOServer } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../shared/utils/response.js';
import { getChannelPlugin, isLineRetryKeyExpired } from '@open333crm/channel-plugins';
import { logger } from '@open333crm/core';
import { decryptCredentials } from '../channel/channel.service.js';
import {
  renderTemplateBody,
  extractVariables,
  buildVariableMap,
  type TemplateVariable,
} from './template-renderer.js';
import { resolveContext } from './template-context.js';
import { findOrCreateMaterialShortLink } from '../shortlink/shortlink.service.js';
import { notFound } from '../../shared/messages/resource.js';
import { calculateSegmentContacts, effectiveSegmentConditions, type SegmentRules } from './segment.service.js';

// --- Broadcast audience ---

type BroadcastTargetConfig = { tagIds?: string[]; contactIds?: string[] };

function audienceError(path: string, message: string): AppError {
  return new AppError(message, 'INVALID_AUDIENCE', 400, { issues: [{ path, message }] });
}

/**
 * 受眾欄位必須能解析成明確的名單。名單為空時一律拒絕，絕不退化成「發給渠道全部聯絡人」。
 * 建立廣播與發送廣播（含排程器、修正前建立的舊草稿）都經過這裡。
 */
export function assertBroadcastAudience(broadcast: {
  targetType: string;
  segmentId?: string | null;
  targetConfig?: unknown;
}) {
  const config = (broadcast.targetConfig || {}) as BroadcastTargetConfig;
  if (broadcast.targetType === 'segment' && !broadcast.segmentId) {
    throw audienceError('segmentId', '選擇「受眾分群」時必須指定一個分群');
  }
  if (broadcast.targetType === 'tags' && !config.tagIds?.length) {
    throw audienceError('targetConfig.tagIds', '選擇「依標籤篩選」時至少要選一個標籤');
  }
  if (broadcast.targetType === 'contacts' && !config.contactIds?.length) {
    throw audienceError('targetConfig.contactIds', '選擇「手動選擇」時至少要選一位聯絡人');
  }
}

function assertSegmentUsable(segment: { rules: unknown } | null) {
  if (!segment) {
    throw audienceError('segmentId', '所選分群已不存在。為避免發給全部聯絡人，已停止發送，請重新選擇分群');
  }
  if (effectiveSegmentConditions(segment.rules as SegmentRules).length === 0) {
    throw audienceError('segmentId', '所選分群沒有任何有效條件。為避免發給全部聯絡人，請先替分群設定條件');
  }
}

/** 素材的 channelType（line / fb）對應渠道的 ChannelType 列舉（LINE / FB） */
function materialMatchesChannel(materialChannelType: unknown, channelType: unknown) {
  return typeof materialChannelType === 'string'
    && typeof channelType === 'string'
    && materialChannelType.toLowerCase() === channelType.toLowerCase();
}

// --- Template CRUD ---

export async function listTemplates(
  prisma: TenantDb,
  tenantId: string,
  filters: {
    category?: string;
    channelType?: string;
    q?: string;
    page?: number;
    limit?: number;
  } = {},
) {
  const { category, channelType, q, page = 1, limit = 50 } = filters;

  const where: Record<string, unknown> = {
    tenantId,
  };
  if (category) where.category = category;
  if (channelType) where.channelType = channelType;
  if (q) {
    where.AND = [
      {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ],
      },
    ];
  }

  const [templates, total] = await Promise.all([
    prisma.messageTemplate.findMany({
      where: where as any,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.messageTemplate.count({ where: where as any }),
  ]);

  return { templates, total, page, limit };
}

// --- Broadcast CRUD ---

export async function listBroadcasts(
  prisma: TenantDb,
  tenantId: string,
  filters: { campaignId?: string; status?: string; page?: number; limit?: number } = {},
) {
  const { campaignId, status, page = 1, limit = 50 } = filters;
  const where: Record<string, unknown> = { tenantId };
  if (campaignId) where.campaignId = campaignId;
  if (status) where.status = status;

  const [broadcasts, total] = await Promise.all([
    prisma.broadcast.findMany({
      where: where as any,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        material: { select: { id: true, name: true, channelType: true, contentType: true } },
      },
    }),
    prisma.broadcast.count({ where: where as any }),
  ]);

  return { broadcasts, total, page, limit };
}

export async function getBroadcast(prisma: TenantDb, id: string, tenantId: string) {
  const broadcast = await prisma.broadcast.findFirst({
    where: { id, tenantId },
    include: {
      material: { select: { id: true, name: true, channelType: true, contentType: true } },
    },
  });
  if (!broadcast) {
    throw new AppError(notFound('broadcast'), 'NOT_FOUND', 404);
  }

  // Add recipient-level metrics
  const [replied, casesOpened] = await Promise.all([
    prisma.broadcastRecipient.count({
      where: { broadcastId: id, replied: true },
    }),
    prisma.broadcastRecipient.count({
      where: { broadcastId: id, caseId: { not: null } },
    }),
  ]);

  return {
    ...broadcast,
    replied,
    casesOpened,
    replyRate: broadcast.successCount > 0 ? Math.round((replied / broadcast.successCount) * 100) : 0,
  };
}

export async function createBroadcast(
  prisma: TenantDb,
  tenantId: string,
  agentId: string,
  data: {
    name: string;
    materialId?: string;
    templateId?: string;
    channelId: string;
    campaignId?: string;
    segmentId?: string;
    targetType: 'all' | 'segment' | 'tags' | 'contacts';
    targetConfig?: { tagIds?: string[]; contactIds?: string[] };
    scheduledAt?: string;
  },
) {
  if (Boolean(data.materialId) === Boolean(data.templateId)) {
    throw new AppError('素材與版型請擇一提供，不可同時或都不填', 'INVALID_INPUT', 400);
  }

  assertBroadcastAudience(data);

  // 排程時間必須晚於現在：排程器每 60 秒取 scheduledAt <= now 的廣播執行，
  // 排到過去等於一分鐘內立即發送給客人。REST 與 MCP 都經過這裡
  if (data.scheduledAt) {
    const at = new Date(data.scheduledAt);
    const message = Number.isNaN(at.getTime())
      ? '排程時間格式不正確'
      : at.getTime() <= Date.now()
        ? '排程時間必須晚於現在；要立即發送請不要設定排程時間'
        : null;
    if (message) {
      throw new AppError(message, 'VALIDATION_ERROR', 400, { issues: [{ path: 'scheduledAt', message }] });
    }
  }

  // 驗證來源（Material 或舊 Template）
  let materialChannelType: string | null = null;
  if (data.materialId) {
    const material = await prisma.material.findFirst({
      where: { id: data.materialId, tenantId, isActive: true },
    });
    if (!material) {
      throw new AppError(notFound('material'), 'NOT_FOUND', 404);
    }
    materialChannelType = material.channelType;
  } else {
    const template = await prisma.messageTemplate.findFirst({
      where: {
        id: data.templateId!,
        tenantId,
      },
    });
    if (!template) {
      throw new AppError(notFound('template'), 'NOT_FOUND', 404);
    }
  }

  // Validate channel exists
  const channel = await prisma.channel.findFirst({
    where: { id: data.channelId, tenantId, isActive: true },
  });
  if (!channel) {
    throw new AppError('找不到此渠道或渠道已停用，請至設定確認', 'NOT_FOUND', 404);
  }

  // 素材與渠道要相符：FB 素材排給 LINE 渠道，發送時才會整批失敗
  if (data.materialId && !materialMatchesChannel(materialChannelType, channel.channelType)) {
    const message = '素材的渠道與廣播渠道不符，請選擇此渠道的素材';
    throw new AppError(message, 'MATERIAL_CHANNEL_MISMATCH', 400, { issues: [{ path: 'materialId', message }] });
  }

  // Validate campaign if provided
  if (data.campaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: data.campaignId, tenantId },
    });
    if (!campaign) {
      throw new AppError(notFound('campaign'), 'NOT_FOUND', 404);
    }
  }

  // Validate segment if provided
  if (data.segmentId) {
    const segment = await prisma.segment.findFirst({
      where: { id: data.segmentId, tenantId },
    });
    if (!segment) {
      throw new AppError(notFound('segment'), 'NOT_FOUND', 404);
    }
    if (data.targetType === 'segment') assertSegmentUsable(segment);
  }

  const status = data.scheduledAt ? 'scheduled' : 'draft';

  const broadcast = await prisma.broadcast.create({
    data: {
      tenantId,
      name: data.name,
      materialId: data.materialId || null,
      templateId: data.templateId || null,
      channelId: data.channelId,
      campaignId: data.campaignId || null,
      segmentId: data.segmentId || null,
      targetType: data.targetType,
      targetConfig: (data.targetConfig || {}) as any,
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
      status,
      createdById: agentId,
    },
  });

  return broadcast;
}

export async function cancelBroadcast(prisma: TenantDb, id: string, tenantId: string) {
  const broadcast = await prisma.broadcast.findFirst({
    where: { id, tenantId },
  });
  if (!broadcast) {
    throw new AppError(notFound('broadcast'), 'NOT_FOUND', 404);
  }
  // 狀態清單取 main 的版本（LINE 重試機制要能取消 sending/failed 的群發），
  // 訊息取本分支的中文版。
  if (!['draft', 'scheduled', 'sending', 'failed'].includes(broadcast.status)) {
    throw new AppError('此群發目前的狀態無法取消', 'INVALID_STATUS', 400);
  }

  const updated = await prisma.broadcast.update({
    where: { id },
    data: { status: 'cancelled' },
  });
  return updated;
}

/**
 * 遞迴走訪素材 body，把所有 `{ type:'uri', uri }` 動作的 uri 換成帶 materialId 的短連結，
 * 讓廣播點擊可歸因回素材（素材層共用一條，非 per-recipient）。
 * 涵蓋所有版型（carousel action1/2、imagemap area.action、video endCard、flex button）——
 * 靠遞迴找 type==='uri' 物件，不綁死結構。回傳深拷貝後的新 body（不改原素材）。
 */
async function convertBodyUrlsToShortLinks(
  prisma: PrismaClient,
  tenantId: string,
  createdById: string,
  materialId: string,
  lineChannelId: string | null,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const clone: unknown = JSON.parse(JSON.stringify(body));

  async function walk(node: unknown): Promise<void> {
    if (Array.isArray(node)) {
      for (const item of node) await walk(item);
      return;
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      // LINE Flex 的連結按鈕是 action.uri；本地版型是 {type:'uri', uri}。兩種都攔。
      // action 上若有 tagOnClick（點擊後貼標），一併灌進短連結，並從 body 移除
      // （tagOnClick 是內部欄位，若留在 flex button action 會流進 LINE payload 被擋 unknown field）。
      if (obj.type === 'uri' && typeof obj.uri === 'string' && obj.uri) {
        obj.uri = await findOrCreateMaterialShortLink(prisma, tenantId, createdById, {
          materialId,
          targetUrl: obj.uri,
          lineChannelId,
          tagOnClick: typeof obj.tagOnClick === 'string' ? obj.tagOnClick : undefined,
        });
        delete obj.tagOnClick;
      }
      // imagemap 轉出的 linkUri（builders 用 linkUri），也一併處理
      if (typeof obj.linkUri === 'string' && obj.linkUri) {
        obj.linkUri = await findOrCreateMaterialShortLink(prisma, tenantId, createdById, {
          materialId,
          targetUrl: obj.linkUri,
          lineChannelId,
          tagOnClick: typeof obj.tagOnClick === 'string' ? obj.tagOnClick : undefined,
        });
        delete obj.tagOnClick;
      }
      for (const key of Object.keys(obj)) await walk(obj[key]);
    }
  }

  await walk(clone);
  return clone as Record<string, unknown>;
}

const SENDABLE_STATUSES = ['draft', 'scheduled', 'failed'];

/** 非預期錯誤（不是 AppError）寫給後台看的原因：不外露內部錯誤內容（issue #287） */
const UNEXPECTED_FAILURE_REASON = '發送時發生系統錯誤，請稍後重新發送；若持續失敗請聯絡管理員';

/** 失敗原因寫進資料庫的長度上限：渠道錯誤可能很長 */
const FAILURE_REASON_MAX_LENGTH = 500;

/** 全部收件人都失敗時的原因：失敗人數加上第一個渠道錯誤，讓行銷人員知道要從哪裡修 */
function allRecipientsFailedReason(count: number, firstError: string | null): string {
  const head = `全部 ${count} 位對象都發送失敗`;
  const reason = firstError ? `${head}。渠道回應：${firstError}` : `${head}，渠道沒有回傳原因`;
  return reason.slice(0, FAILURE_REASON_MAX_LENGTH);
}

function alreadySendingError() {
  return new AppError('此廣播正在發送中或已開始發送，請勿重複發送，稍後重新整理查看結果', 'BROADCAST_ALREADY_SENDING', 409);
}

/**
 * Execute a broadcast: resolve audience, send personalized messages, update stats.
 */
export async function executeBroadcast(
  prisma: TenantDb,
  io: SocketIOServer,
  broadcastId: string,
) {
  const broadcast = await prisma.broadcast.findFirst({
    where: { id: broadcastId },
  });
  if (!broadcast) {
    throw new AppError(notFound('broadcast'), 'NOT_FOUND', 404);
  }
  // 只有草稿、已排程、失敗（重試）可以開始發送；發送中的廣播不可再發，避免重複群發
  if (broadcast.status === 'sending') {
    throw alreadySendingError();
  }
  if (!SENDABLE_STATUSES.includes(broadcast.status)) {
    throw new AppError('此群發目前的狀態無法發送', 'INVALID_STATUS', 400);
  }

  // 以單一條件更新搶占 sending：兩個請求（重複按、或與排程器同時）只有一個搶得到
  const claimed = await prisma.broadcast.updateMany({
    where: { id: broadcastId, tenantId: broadcast.tenantId, status: { in: SENDABLE_STATUSES } },
    // 開始發送時清掉上一次的失敗原因，重送成功後不留舊原因
    data: { status: 'sending', sentAt: new Date(), failureReason: null },
  });
  if (claimed.count === 0) {
    throw alreadySendingError();
  }

  try {
    if (!broadcast.channelId || !broadcast.tenantId || !broadcast.createdById) {
      throw new AppError('群發設定不完整，請補齊後再送出', 'INVALID_STATE', 400);
    }
    if (!broadcast.materialId && !broadcast.templateId) {
      throw new AppError('群發尚未設定發送內容', 'INVALID_STATE', 400);
    }

    // 取得內容來源：優先 Material，舊資料 fallback Template
    let contentType: string;
    let body: Record<string, unknown>;
    let sourceVars: TemplateVariable[];

    if (broadcast.materialId) {
      const material = await prisma.material.findFirst({
        where: { id: broadcast.materialId, tenantId: broadcast.tenantId },
      });
      if (!material) {
        throw new AppError(notFound('material'), 'NOT_FOUND', 404);
      }
      contentType = material.contentType;
      body = material.body as Record<string, unknown>;
      sourceVars = (material.variables || []) as unknown as TemplateVariable[];

      // 素材級點擊歸因：把 body 內的外部連結換成帶 materialId 的短連結（素材層共用，
      // 所有收件人同一條）。失敗不阻斷發送——退回原 body。
      if (broadcast.createdById) {
        try {
          // lineChannelId 傳 null：它只影響短連結的 UA 轉址策略，與素材點擊歸因無關；
          // 且此處未載入 channel 型別，傳 channelId 可能觸發 assertLineChannel 對 FB channel 報錯。
          body = await convertBodyUrlsToShortLinks(
            prisma as PrismaClient,
            broadcast.tenantId,
            broadcast.createdById,
            material.id,
            null,
            body,
          );
        } catch (err) {
          logger.error('[Broadcast] URL→shortlink conversion failed, sending original body:', err);
        }
      }
    } else {
      const template = await prisma.messageTemplate.findFirst({
        where: {
          id: broadcast.templateId!,
          tenantId: broadcast.tenantId,
        },
      });
      if (!template) {
        throw new AppError(notFound('template'), 'NOT_FOUND', 404);
      }
      contentType = template.contentType;
      body = template.body as Record<string, unknown>;
      sourceVars = (template.variables || []) as unknown as TemplateVariable[];
    }

    // Get channel + plugin
    const channel = await prisma.channel.findFirst({
      where: { id: broadcast.channelId, tenantId: broadcast.tenantId, isActive: true },
    });
    if (!channel) {
      throw new AppError('找不到此渠道或渠道已停用，請至設定確認', 'NOT_FOUND', 404);
    }

    const plugin = getChannelPlugin(channel.channelType);
    if (!plugin) {
      throw new AppError(`此渠道類型（${channel.channelType}）不支援發送廣播`, 'UNSUPPORTED_CHANNEL', 400);
    }
    // 憑證解密：金鑰不符（如從其他環境 sync 來的 token）會拋原生錯，
    // 包成友善 AppError 避免冒成裸 500「An unexpected error occurred」。
    let credentials: Record<string, unknown>;
    try {
      credentials = decryptCredentials(channel.credentialsEncrypted);
    } catch {
      throw new AppError(
        '此渠道的憑證無法解密（金鑰不符，常見於從其他環境同步過來的資料）。請到渠道設定重新填入 Access Token 後再發送。',
        'CHANNEL_CREDENTIAL_DECRYPT_FAILED',
        400,
      );
    }

    // Resolve audience
    const matched = await resolveAudience(prisma, broadcast);
    // FB／IG 只能發給視窗內互動過的人：視窗外的人送了也會被平台擋下，不送出
    const windowHours = plugin.messagingWindowHours;
    const identities = await filterByMessagingWindow(prisma, broadcast.tenantId, broadcast.channelId, matched, windowHours);
    const skippedCount = matched.length - identities.length;

    // Update total count
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: { totalCount: matched.length, skippedCount },
    });

    // 0 受眾：手動挑選/標籤/分群卻解析不到任何可發送對象時，回明確錯誤而非默默「完成」，
    // 避免使用者以為發成功了其實沒發（如手動挑選未選人、或選的人在此渠道沒有身分）。
    if (matched.length === 0) {
      const reason =
        broadcast.targetType === 'contacts'
          ? '未選擇任何發送對象，或所選對象在此渠道沒有可發送的身分。請先挑選有加入此渠道的對象。'
          : broadcast.targetType === 'tags'
            ? '所選標籤下沒有可在此渠道發送的對象。'
            : broadcast.targetType === 'segment'
              ? '所選分群目前沒有可在此渠道發送的對象。'
              : '此渠道目前沒有可發送的對象。';
      // 拋出後由外層 catch 統一標 failed（0 受眾＝送不出去，算失敗）。
      throw new AppError(reason, 'BROADCAST_NO_RECIPIENTS', 400);
    }
    if (identities.length === 0) {
      throw new AppError(
        `符合條件的 ${skippedCount} 位對象都超過 ${windowHours} 小時沒有傳訊息給我們。此渠道只能發給 ${windowHours} 小時內傳過訊息的人，所以沒有送出。`,
        'BROADCAST_OUTSIDE_MESSAGING_WINDOW',
        400,
      );
    }

    const extractedKeys = extractVariables(body);
    const needsPersonalization = extractedKeys.length > 0;

    let successCount = 0;
    let failedCount = 0;
    // 第一個渠道錯誤：全部失敗時寫進 failureReason
    let firstError: string | null = null;
    const noteError = (err: unknown) => {
      if (firstError || err == null) return;
      firstError = err instanceof Error ? err.message : String(err);
    };
    const now = new Date();

    // ── LINE multicast 路徑：無需 per-recipient 個人化 ──
    // 條件：LINE 渠道 + 訊息內無變數
    // multicast 一次發給多人，全員看到完全相同的訊息（FB 無此 API）。
    // service 層自己 chunk 為 499/批（LINE 官方限 500，留 1 個 buffer）。
    // 每批單獨呼叫 plugin → 失敗只影響該批的 recipient 標 failed，前面批已成功不誤標。
    // 個人化分支仍走 for loop push（每人 body 不同）。
    if (channel.channelType === 'LINE' && !needsPersonalization) {
      const MULTICAST_CHUNK = 499;
      for (let i = 0; i < identities.length; i += MULTICAST_CHUNK) {
        const chunk = identities.slice(i, i + MULTICAST_CHUNK);
        const uids = chunk.map((c) => c.uid);
        const outbound = {
          contentType,
          content: { ...body, strategy: 'multicast', recipientUids: uids },
        };

        const batchIndex = Math.floor(i / MULTICAST_CHUNK);
        let attempt = await prisma.broadcastDeliveryAttempt.findFirst({
          where: { tenantId: broadcast.tenantId, broadcastId, batchIndex },
        });
        if (!attempt) {
          attempt = await prisma.broadcastDeliveryAttempt.create({
            data: {
              tenantId: broadcast.tenantId,
              broadcastId,
              batchIndex,
              retryKey: randomUUID(),
              status: 'pending',
            },
          });
        } else if (attempt.status !== 'accepted' && isLineRetryKeyExpired(attempt.updatedAt)) {
          const rotatedRetryKey = randomUUID();
          await prisma.broadcastDeliveryAttempt.updateMany({
            where: { id: attempt.id, tenantId: broadcast.tenantId },
            data: {
              retryKey: rotatedRetryKey,
              status: 'pending',
              lineRequestId: null,
              errorCode: null,
              errorMessage: null,
            },
          });
          attempt = { ...attempt, retryKey: rotatedRetryKey, status: 'pending' };
        }

        let chunkDelivered = attempt.status === 'accepted';
        try {
          if (!chunkDelivered) {
            const result = await plugin.sendMessage(
              uids[0],
              { ...outbound, delivery: { retryKey: attempt.retryKey } },
              credentials,
            );
            chunkDelivered = result.success;
            if (!result.success) noteError(result.error ?? null);
            await prisma.broadcastDeliveryAttempt.updateMany({
              where: { id: attempt.id, tenantId: broadcast.tenantId },
              data: {
                status: result.success ? 'accepted' : 'failed',
                lineRequestId: result.requestId ?? null,
                errorMessage: result.error ?? null,
              },
            });
          }
          if (chunkDelivered) successCount += chunk.length;
          else failedCount += chunk.length;
        } catch (err) {
          logger.error(`[broadcast:${broadcastId}] multicast chunk send failed (chunk ${i / MULTICAST_CHUNK + 1})`, { err });
          noteError(err);
          await prisma.broadcastDeliveryAttempt.updateMany({
            where: { id: attempt.id, tenantId: broadcast.tenantId },
            data: { status: 'failed', errorMessage: String(err) },
          });
          failedCount += chunk.length;
        }

        // 該批 recipient 記錄
        try {
          await prisma.broadcastRecipient.createMany({
            data: chunk.map((identity) => ({
              broadcastId,
              contactId: identity.contactId,
              deliveryStatus: chunkDelivered ? 'sent' : 'failed',
              sentAt: now,
            })),
            skipDuplicates: true,
          });
        } catch (err) {
          logger.warn(`[broadcast:${broadcastId}] recipient batch write failed (chunk ${i / MULTICAST_CHUNK + 1})`, { err });
        }
      }
    } else {
      // ── per-recipient for loop（個人化 / FB / 其他渠道）──
      for (const identity of identities) {
        let delivered = false;
        try {
          // Per-recipient personalization
          let personalizedBody = body;
          if (needsPersonalization) {
            const ctx = await resolveContext(prisma, {
              contactId: identity.contactId,
              tenantId: broadcast.tenantId,
            });
            const vars = buildVariableMap(sourceVars, ctx);
            personalizedBody = renderTemplateBody(body, vars);
          }

          const outbound = {
            contentType,
            content: personalizedBody,
          };

          const result = await plugin.sendMessage(identity.uid, outbound, credentials);
          if (result.success) {
            successCount++;
            delivered = true;
          } else {
            failedCount++;
            noteError(result.error ?? null);
          }
        } catch (err) {
          failedCount++;
          noteError(err);
        }

        // Create recipient record for tracking replies & cases
        try {
          await prisma.broadcastRecipient.create({
            data: {
              broadcastId,
              contactId: identity.contactId,
              deliveryStatus: delivered ? 'sent' : 'failed',
              sentAt: now,
            },
          });
        } catch {
          // Ignore duplicate (unique constraint on broadcastId+contactId)
        }
      }
    }

    // 累計使用次數
    if (broadcast.materialId) {
      await prisma.material.update({
        where: { id: broadcast.materialId },
        data: { usageCount: { increment: 1 }, lastUsedAt: now },
      });
    } else if (broadcast.templateId) {
      await prisma.messageTemplate.update({
        where: { id: broadcast.templateId },
        data: { usageCount: { increment: 1 } },
      });
    }

    // Final status
    // failed：全員失敗（含 0 受眾的 case 已在前面 early return，此處 identities.length 必 > 0）
    // completed：至少 1 人成功（含部分失敗）
    const finalStatus = failedCount > 0 && failedCount === identities.length ? 'failed' : 'completed';
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: {
        status: finalStatus,
        successCount,
        failedCount,
        failureReason: finalStatus === 'failed' ? allRecipientsFailedReason(failedCount, firstError) : null,
      },
    });

    return { total: matched.length, success: successCount, failed: failedCount, skipped: skippedCount };
  } catch (err) {
    // 排程發送沒有人看得到回應：原因要寫進資料庫，後台才看得到（issue #287）
    const failureReason = err instanceof AppError ? err.message.slice(0, FAILURE_REASON_MAX_LENGTH) : UNEXPECTED_FAILURE_REASON;
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: { status: 'failed', failureReason },
    });
    throw err;
  }
}

/** 一次查詢的聯絡人數上限：避免超過 Postgres 的參數個數上限 */
const WINDOW_QUERY_CHUNK = 5000;

/**
 * 有訊息視窗的渠道（FB／IG 24 小時）只留下視窗內在此渠道傳過訊息的人。
 * 視窗從顧客傳入的訊息（含按鈕回應）起算；沒有視窗的渠道原樣回傳。
 */
async function filterByMessagingWindow<T extends { contactId: string }>(
  prisma: TenantDb,
  tenantId: string,
  channelId: string,
  identities: T[],
  windowHours: number | undefined,
  now = new Date(),
): Promise<T[]> {
  if (!windowHours || identities.length === 0) return identities;
  const since = new Date(now.getTime() - windowHours * 3600_000);
  const contactIds = [...new Set(identities.map((i) => i.contactId))];
  const active = new Set<string>();
  for (let i = 0; i < contactIds.length; i += WINDOW_QUERY_CHUNK) {
    const rows = await prisma.conversation.findMany({
      where: {
        tenantId,
        channelId,
        contactId: { in: contactIds.slice(i, i + WINDOW_QUERY_CHUNK) },
        messages: { some: { direction: 'INBOUND', senderType: 'CONTACT', createdAt: { gte: since } } },
      },
      select: { contactId: true },
    });
    for (const row of rows) active.add(row.contactId);
  }
  return identities.filter((i) => active.has(i.contactId));
}

/**
 * 預估群發受眾：用和實際發送相同的受眾解析與訊息視窗，回傳符合條件與可送達人數，不建立群發。
 */
export async function previewBroadcastAudience(
  prisma: TenantDb,
  tenantId: string,
  input: {
    channelId: string;
    targetType: string;
    segmentId?: string | null;
    targetConfig?: BroadcastTargetConfig;
  },
) {
  const channel = await prisma.channel.findFirst({
    where: { id: input.channelId, tenantId, isActive: true },
    select: { id: true, channelType: true },
  });
  if (!channel) {
    throw new AppError('找不到此渠道或渠道已停用，請至設定確認', 'NOT_FOUND', 404);
  }
  const matched = await resolveAudience(prisma, {
    tenantId,
    channelId: channel.id,
    targetType: input.targetType,
    segmentId: input.segmentId ?? null,
    targetConfig: input.targetConfig ?? {},
  });
  const windowHours = getChannelPlugin(channel.channelType)?.messagingWindowHours;
  const reachable = await filterByMessagingWindow(prisma, tenantId, channel.id, matched, windowHours);
  return { matched: matched.length, reachable: reachable.length, messagingWindowHours: windowHours ?? null };
}

/**
 * Resolve audience for a broadcast based on targetType.
 */
async function resolveAudience(
  prisma: TenantDb,
  broadcast: {
    tenantId: string;
    channelId: string;
    targetType: string;
    segmentId: string | null;
    targetConfig: unknown;
  },
) {
  const config = (broadcast.targetConfig || {}) as BroadcastTargetConfig;

  // fail-closed：名單為空（含修正前建立的舊草稿）一律拒絕，不可落到下方「全渠道」查詢
  assertBroadcastAudience(broadcast);

  const identityWhere: Record<string, unknown> = {
    channelId: broadcast.channelId,
    contact: { tenantId: broadcast.tenantId, isArchived: false },
  };

  if (broadcast.targetType === 'segment' && broadcast.segmentId) {
    // Use segment rules to find contacts
    const segment = await prisma.segment.findFirst({
      where: { id: broadcast.segmentId, tenantId: broadcast.tenantId },
    });
    // 分群被刪除或沒有有效條件：停止發送，絕不退化成全渠道
    assertSegmentUsable(segment);
    const { contactIds } = await calculateSegmentContacts(
      prisma,
      broadcast.tenantId,
      segment!.rules as unknown as SegmentRules,
    );
    if (contactIds.length > 0) {
      identityWhere.contactId = { in: contactIds };
    } else {
      return [];
    }
  } else if (broadcast.targetType === 'tags' && config.tagIds?.length) {
    identityWhere.contact = {
      tenantId: broadcast.tenantId,
      isArchived: false,
      tags: { some: { tagId: { in: config.tagIds } } },
    };
  } else if (broadcast.targetType === 'contacts' && config.contactIds?.length) {
    identityWhere.contactId = { in: config.contactIds };
  }

  const identities = await prisma.channelIdentity.findMany({
    where: identityWhere,
    select: {
      uid: true,
      contactId: true,
    },
  });

  return identities;
}
