/**
 * FB／IG webhook 依帳號 ID 分派渠道與租戶（change fix-meta-webhook-page-routing，design D2–D4）。
 *
 * 一個 Meta App 的 Page webhook 只能設一個回呼網址，多個粉專共用同一個 App 時，
 * 所有粉專的事件都會打到同一個網址。只看網址上的 channelId 會把別的粉專（甚至別的租戶）
 * 的訊息寫進網址那個渠道。這裡改依事件的 entry.id（插件解析為 accountId）找出真正的渠道。
 *
 * 規則：
 *   - accountId 等於網址渠道的外部帳號 ID → 網址渠道
 *   - 其他渠道以（渠道類型＋外部帳號 ID）認領 → 該渠道；但必須是同一個 Meta App
 *     （App Secret 與驗簽用的相同），否則丟棄——避免有人用自己 App 的簽章把事件灌進別人的粉專
 *   - 沒有任何渠道認領：
 *       網址渠道還沒有外部帳號 ID（尚未驗證／回填）→ 相容模式，照舊交給網址渠道並記警示
 *       網址渠道已有不同的外部帳號 ID → 丟棄並記警示，絕不寫進網址渠道的租戶
 *
 * 警示寫在網址渠道的 settings.webhookRouting，後台渠道管理看得到（不只寫 log）。
 */
import type { PrismaClient } from '@prisma/client';
import type { ParsedWebhookMessage } from '@open333crm/channel-plugins';
import { logger } from '@open333crm/core';
import { CHANNEL_TYPE } from '@open333crm/shared';
import { decryptCredentials } from '../channel/channel.service.js';

/** 需要依帳號分派的渠道類型（LINE 每個 OA 各自設 webhook，沒有共用回呼的問題） */
const ROUTED_CHANNEL_TYPES = new Set<string>([CHANNEL_TYPE.FB, CHANNEL_TYPE.THREADS]);

export type RoutingWarningReason =
  /** 網址渠道還沒有外部帳號 ID，暫以相容模式照舊收件 */
  | 'account_id_missing'
  /** 收到沒有任何渠道認領的帳號事件，已丟棄 */
  | 'unrouted_account'
  /** 認領該帳號的渠道使用不同的 Meta App，已丟棄 */
  | 'app_mismatch'
  /** 整包含其他渠道的事件，無法轉發給下游 */
  | 'downstream_skipped';

export interface RoutingChannel {
  id: string;
  tenantId: string;
  channelType: string;
  externalAccountId: string | null;
}

export interface RoutedGroup {
  channel: RoutingChannel;
  credentials: Record<string, unknown>;
  messages: ParsedWebhookMessage[];
  /** 目標渠道的 settings（網址渠道本身不帶，呼叫端已有）；用來檢查目標渠道自己的下游轉發設定 */
  settings?: unknown;
}

export interface RoutingResult {
  groups: RoutedGroup[];
  /** 整包事件是否都屬於網址渠道（且沒有丟棄）；下游轉發只在此時進行 */
  allToUrlChannel: boolean;
}

/** 設 META_WEBHOOK_ROUTING=legacy 可退回純網址分派（上線觀察期的回滾開關，保留一版後移除） */
function legacyRoutingEnabled(): boolean {
  return process.env.META_WEBHOOK_ROUTING === 'legacy';
}

export async function routeWebhookMessages(
  prisma: PrismaClient,
  urlChannel: RoutingChannel,
  urlCredentials: Record<string, unknown>,
  /** 驗簽實際使用的 secret（FB／IG 為 App Secret） */
  verifySecret: string,
  messages: ParsedWebhookMessage[],
): Promise<RoutingResult> {
  const urlGroup: RoutedGroup = { channel: urlChannel, credentials: urlCredentials, messages: [] };
  if (!ROUTED_CHANNEL_TYPES.has(urlChannel.channelType) || legacyRoutingEnabled()) {
    urlGroup.messages = messages;
    return { groups: messages.length ? [urlGroup] : [], allToUrlChannel: true };
  }

  const byAccount = new Map<string | undefined, ParsedWebhookMessage[]>();
  for (const m of messages) {
    const list = byAccount.get(m.accountId) ?? [];
    list.push(m);
    byAccount.set(m.accountId, list);
  }

  const others: RoutedGroup[] = [];
  let allToUrlChannel = true;

  for (const [accountId, list] of byAccount) {
    // 沒有 accountId（插件未帶出）或就是網址渠道自己的帳號 → 網址渠道
    if (!accountId || accountId === urlChannel.externalAccountId) {
      urlGroup.messages.push(...list);
      continue;
    }

    const found = await prisma.channel.findUnique({
      where: { channelType_externalAccountId: { channelType: urlChannel.channelType as never, externalAccountId: accountId } },
      select: {
        id: true,
        tenantId: true,
        channelType: true,
        externalAccountId: true,
        isActive: true,
        credentialsEncrypted: true,
        settings: true,
        tenant: { select: { isActive: true } },
      },
    });
    // 停用的渠道或停用租戶的渠道視同沒人認領：不可讓它安靜吞掉事件（新渠道會永遠收不到），
    // 改走下面「沒人認領」的規則並留下警示
    const target = found && found.isActive && found.tenant?.isActive ? found : null;
    if (found && !target) {
      logger.info('[Webhook] 認領帳號的渠道或租戶已停用，視同未認領', { targetChannelId: found.id, accountId });
    }

    if (!target) {
      if (!urlChannel.externalAccountId) {
        // 相容模式：網址渠道尚未取得帳號 ID，無法判斷事件是否屬於它，維持舊行為並提示去驗證
        urlGroup.messages.push(...list);
        await recordRoutingWarning(prisma, urlChannel, 'account_id_missing', accountId);
        continue;
      }
      allToUrlChannel = false;
      logger.warn('[Webhook] 收到沒有任何渠道認領的帳號事件，已丟棄', {
        urlChannelId: urlChannel.id,
        accountId,
        count: list.length,
      });
      await recordRoutingWarning(prisma, urlChannel, 'unrouted_account', accountId);
      continue;
    }

    // 以下各分支都不是網址渠道的事件（改派或丟棄）
    allToUrlChannel = false;

    let targetCredentials: Record<string, unknown>;
    try {
      targetCredentials = decryptCredentials(target.credentialsEncrypted);
    } catch (err) {
      logger.error('[Webhook] 目標渠道憑證無法解密，丟棄事件', {
        targetChannelId: target.id,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (!verifySecret || targetCredentials.appSecret !== verifySecret) {
      logger.warn('[Webhook] 認領帳號的渠道使用不同的 Meta App，已丟棄', {
        urlChannelId: urlChannel.id,
        targetChannelId: target.id,
        accountId,
      });
      await recordRoutingWarning(prisma, urlChannel, 'app_mismatch', accountId);
      continue;
    }

    others.push({
      channel: { id: target.id, tenantId: target.tenantId, channelType: target.channelType, externalAccountId: target.externalAccountId },
      credentials: targetCredentials,
      messages: list,
      settings: target.settings,
    });
  }

  const groups = [...(urlGroup.messages.length ? [urlGroup] : []), ...others];
  return { groups, allToUrlChannel };
}

/** 同一種警示與帳號在此時間內只寫一次，避免每則事件都寫 DB */
const WARNING_THROTTLE_MINUTES = 10;

/**
 * 在網址渠道記下分派警示（settings.webhookRouting），渠道管理頁顯示給管理員。
 * 以資料庫端 JSON 合併原子更新，不覆蓋其他 settings；同原因＋同帳號 10 分鐘內只更新一次。
 */
export async function recordRoutingWarning(
  prisma: PrismaClient,
  channel: { id: string; tenantId: string },
  reason: RoutingWarningReason,
  accountId?: string,
): Promise<void> {
  try {
    await prisma.$executeRaw`
      UPDATE channels
      SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
            'webhookRouting',
            jsonb_build_object('reason', ${reason}::text, 'accountId', ${accountId ?? null}::text, 'lastAt', to_jsonb(now()))
          ),
          "updatedAt" = now()
      WHERE id = ${channel.id}::uuid
        AND "tenantId" = ${channel.tenantId}::uuid
        -- 沒有既有警示時比較結果為 NULL，COALESCE 成 false 才會寫入第一筆
        AND NOT COALESCE(
          settings->'webhookRouting'->>'reason' IS NOT DISTINCT FROM ${reason}::text
          AND settings->'webhookRouting'->>'accountId' IS NOT DISTINCT FROM ${accountId ?? null}::text
          AND (settings->'webhookRouting'->>'lastAt')::timestamptz > now() - make_interval(mins => ${WARNING_THROTTLE_MINUTES}::int),
          false
        )`;
  } catch (err) {
    // 警示寫入失敗不可影響收訊；至少留 log
    logger.error('[Webhook] 分派警示寫入失敗', {
      channelId: channel.id,
      reason,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * 平台 Meta App 的事件分派（/api/v1/webhooks/meta，design D8）。沒有網址渠道可退回：
 * 事件只會交給以 Facebook 登入連結（connectMode = 'platform'）的渠道，其餘一律丟棄並記 log。
 * 驗簽已在呼叫前以平台 App Secret 完成。
 */
export async function routePlatformMessages(
  prisma: PrismaClient,
  channelType: string,
  messages: ParsedWebhookMessage[],
): Promise<RoutedGroup[]> {
  const byAccount = new Map<string, ParsedWebhookMessage[]>();
  for (const m of messages) {
    if (!m.accountId) continue;
    byAccount.set(m.accountId, [...(byAccount.get(m.accountId) ?? []), m]);
  }

  const groups: RoutedGroup[] = [];
  for (const [accountId, list] of byAccount) {
    const target = await prisma.channel.findUnique({
      where: { channelType_externalAccountId: { channelType: channelType as never, externalAccountId: accountId } },
      select: {
        id: true,
        tenantId: true,
        channelType: true,
        externalAccountId: true,
        isActive: true,
        credentialsEncrypted: true,
        tenant: { select: { isActive: true } },
      },
    });
    if (!target || !target.isActive || !target.tenant?.isActive) {
      logger.warn('[Webhook:meta] 沒有啟用中的渠道認領此帳號，已丟棄', { channelType, accountId, count: list.length });
      continue;
    }
    let credentials: Record<string, unknown>;
    try {
      credentials = decryptCredentials(target.credentialsEncrypted);
    } catch (err) {
      logger.error('[Webhook:meta] 渠道憑證無法解密，丟棄事件', { channelId: target.id, error: err instanceof Error ? err.message : String(err) });
      continue;
    }
    // 自備 App 的渠道不該收到平台 App 的事件（粉專同時訂閱兩個 App 時會發生），交給它自己的回呼網址處理
    if (credentials.connectMode !== 'platform') {
      logger.warn('[Webhook:meta] 認領帳號的渠道不是平台連結模式，已丟棄', { channelId: target.id, accountId });
      continue;
    }
    groups.push({
      channel: { id: target.id, tenantId: target.tenantId, channelType: target.channelType, externalAccountId: target.externalAccountId },
      credentials,
      messages: list,
    });
  }
  return groups;
}
