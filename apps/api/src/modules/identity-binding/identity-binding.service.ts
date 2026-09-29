/**
 * 跨渠道綁定代碼引擎（change add-cross-channel-one-id，design D3 / D6 / D7 / D8 / D9）。
 *
 * 顧客在 A 渠道取得一次性代碼、在 B 渠道送回，即證明 A、B 兩個身分由同一人操作，
 * 兩個聯絡人以統一合併引擎合併（發碼方為 survivor）。
 *
 * 所有函式接受呼叫端的 Prisma 執行器：webhook 路徑是 prismaAdmin（白名單，查詢一律自帶 tenantId），
 * 客服路徑是 withTenant 的 tx。合併與解除在交易內執行。
 */
import type { Prisma } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { logger } from '@open333crm/core';
import type { TenantDb } from '../../lib/tenant-db.js';
import { deliverToChannel } from '../conversation/conversation.service.js';
import { mergeContacts, revertMerge, type MovedRecords } from '../contact/contact-merge.service.js';
import { buildMessageNewPayload, emitToConversationAndTenant } from '../webhook/inbound-socket-presenter.js';
import {
  BINDING_CODE_TTL_MS,
  MAX_FAILURES_PER_HOUR,
  MAX_ISSUES_PER_HOUR,
  SELF_UNBIND_WINDOW_MS,
  bumpCounter,
  codeKey,
  failCounterKey,
  generateBindingCode,
  issueCounterKey,
  readCounter,
  type BindingCodePayload,
  type BindingStore,
} from './binding-code.js';
import {
  BINDING_TEXT,
  buildBindingLink,
  buildInviteText,
  channelLabel,
  parseIdentityBindingSettings,
  resolveBindingHandle,
  type BindableChannelType,
  type IdentityBindingSettings,
} from './binding-links.js';

export interface BindingDeps {
  store: BindingStore;
  /** 有 io 才推送 socket 事件（測試可省略） */
  io?: SocketIOServer;
  /** 送出訊息到渠道，回傳是否成功；預設走 deliverToChannel */
  deliver?: (db: TenantDb, conversationId: string, text: string) => Promise<boolean>;
  now?: () => number;
}

/** 發碼／兌換／解除時，顧客目前所在的渠道身分 */
export interface BindingActor {
  tenantId: string;
  channelId: string;
  channelType: string;
  channelIdentityId: string;
  uid: string;
  contactId: string;
  conversationId: string;
}

const BINDABLE_TYPES: BindableChannelType[] = ['LINE', 'FB', 'THREADS'];

async function inTransaction<T>(db: TenantDb, fn: (tx: TenantDb) => Promise<T>): Promise<T> {
  const client = db as unknown as { $transaction?: (cb: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T> };
  // 已在交易內（TransactionClient 沒有 $transaction）就直接執行，避免巢狀
  if (typeof client.$transaction === 'function') return client.$transaction((tx) => fn(tx));
  return fn(db);
}

export async function getIdentityBindingSettings(db: TenantDb, tenantId: string): Promise<IdentityBindingSettings> {
  const row = await db.tenantSettings.findFirst({ where: { tenantId }, select: { identityBinding: true } });
  return parseIdentityBindingSettings(row?.identityBinding);
}

// 入站熱路徑每則訊息都要判斷是否啟用；多數租戶沒開，快取 15 秒省下每則訊息一次 DB 往返。
// 設定頁儲存時清除本進程快取；多實例部署時其他實例最多延遲 15 秒生效。
const SETTINGS_CACHE_TTL_MS = 15_000;
const settingsCache = new Map<string, { value: IdentityBindingSettings; expiresAt: number }>();

export async function getIdentityBindingSettingsCached(db: TenantDb, tenantId: string): Promise<IdentityBindingSettings> {
  const hit = settingsCache.get(tenantId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await getIdentityBindingSettings(db, tenantId);
  settingsCache.set(tenantId, { value, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS });
  return value;
}

export function invalidateIdentityBindingSettings(tenantId?: string): void {
  if (tenantId) settingsCache.delete(tenantId);
  else settingsCache.clear();
}

/**
 * 送出一則綁定訊息並寫入對話紀錄（以 Bot 訊息呈現，保留換行，客服看得出顧客收到了什麼）。
 * 送出失敗時比照 worker 的 recordDeliveryFailure 慣例，在該則訊息標 metadata.deliveryFailed，
 * 收件匣會顯示成紅色「沒有送出」提示，不讓失敗只留在 log。
 */
async function sendBindingMessage(
  db: TenantDb,
  deps: BindingDeps,
  tenantId: string,
  conversationId: string,
  text: string,
  kind: string,
): Promise<boolean> {
  const ok = await (deps.deliver ?? deliverToChannel)(db, conversationId, text);
  if (!ok) logger.warn('[IdentityBinding] 綁定訊息送出失敗', { conversationId, kind });

  const message = await db.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      senderType: 'BOT',
      contentType: 'text',
      content: { text },
      metadata: {
        source: 'identity_binding',
        kind,
        ...(ok ? {} : { deliveryFailed: true, deliveryError: BINDING_TEXT.deliveryFailed }),
      },
    },
  });
  await db.conversation.updateMany({ where: { id: conversationId, tenantId }, data: { lastMessageAt: new Date() } });
  if (deps.io) {
    const payload = buildMessageNewPayload(message, { content: { text }, includeTypePayload: true, includeMetadata: true });
    emitToConversationAndTenant(deps.io, conversationId, tenantId, 'message.new', payload);
  }
  return ok;
}

// ── 發碼 ────────────────────────────────────────────────────────────────────

export type IssueResult =
  | { status: 'sent'; code: string; targets: number }
  | { status: 'no_targets' }
  | { status: 'rate_limited' };

/**
 * 為顧客目前的渠道身分產生綁定代碼，並在該對話送出其他渠道的導流連結。
 */
export async function issueBindingCode(db: TenantDb, deps: BindingDeps, actor: BindingActor): Promise<IssueResult> {
  const { tenantId } = actor;

  const issued = await bumpCounter(deps.store, issueCounterKey(actor.channelIdentityId));
  if (issued > MAX_ISSUES_PER_HOUR) {
    await sendBindingMessage(db, deps, tenantId, actor.conversationId, BINDING_TEXT.rateLimited, 'rate_limited');
    return { status: 'rate_limited' };
  }

  const channels = await db.channel.findMany({
    where: { tenantId, isActive: true, channelType: { in: BINDABLE_TYPES }, id: { not: actor.channelId } },
    select: { id: true, channelType: true, displayName: true, settings: true },
    orderBy: [{ channelType: 'asc' }, { createdAt: 'asc' }],
  });
  const targets = channels
    .map((c) => ({ channelType: c.channelType as BindableChannelType, displayName: c.displayName, handle: resolveBindingHandle(c.settings) }))
    .filter((t): t is { channelType: BindableChannelType; displayName: string; handle: string } => t.handle !== null);

  if (targets.length === 0) {
    await sendBindingMessage(db, deps, tenantId, actor.conversationId, BINDING_TEXT.noTargets, 'no_targets');
    return { status: 'no_targets' };
  }

  const payload: BindingCodePayload = {
    tenantId,
    contactId: actor.contactId,
    channelIdentityId: actor.channelIdentityId,
    channelId: actor.channelId,
    conversationId: actor.conversationId,
    issuedAt: (deps.now ?? Date.now)(),
  };
  let code = '';
  for (let attempt = 0; attempt < 3 && !code; attempt++) {
    const candidate = generateBindingCode();
    const ok = await deps.store.set(codeKey(tenantId, candidate), JSON.stringify(payload), 'PX', BINDING_CODE_TTL_MS, 'NX');
    if (ok === 'OK') code = candidate;
  }
  if (!code) throw new Error('無法產生不重複的綁定代碼');

  const links = targets.map((t) => buildBindingLink(t, code));
  await sendBindingMessage(db, deps, tenantId, actor.conversationId, buildInviteText(links, code), 'invite');
  logger.info('[IdentityBinding] 已發出綁定代碼', { tenantId, channelIdentityId: actor.channelIdentityId, targets: targets.length });
  return { status: 'sent', code, targets: targets.length };
}

// ── 兌換 ────────────────────────────────────────────────────────────────────

export type RedeemResult =
  | { status: 'bound'; survivorId: string; mergedId: string; mergeLogId: string }
  | { status: 'invalid' }
  | { status: 'throttled' }
  | { status: 'same_identity' }
  | { status: 'channel_conflict' }
  | { status: 'already_bound' };

/** 沿 mergedIntoId 找到目前仍在使用的聯絡人（發碼方可能在兌換前已被併入別人） */
async function resolveLiveContactId(db: TenantDb, tenantId: string, contactId: string): Promise<string | null> {
  let cursor = contactId;
  for (let i = 0; i < 20; i++) {
    const c = await db.contact.findFirst({ where: { id: cursor, tenantId }, select: { isArchived: true, mergedIntoId: true } });
    if (!c) return null;
    if (!c.isArchived) return cursor;
    if (!c.mergedIntoId) return null;
    cursor = c.mergedIntoId;
  }
  return null;
}

export async function redeemBindingCode(
  db: TenantDb,
  deps: BindingDeps,
  actor: BindingActor,
  code: string,
): Promise<RedeemResult> {
  const { tenantId } = actor;
  const now = (deps.now ?? Date.now)();

  const failKey = failCounterKey(actor.channelIdentityId);
  const fail = async (): Promise<RedeemResult> => {
    const failures = await bumpCounter(deps.store, failKey);
    // 超過上限後不再回覆（防止以對話刷訊息猜碼），仍記錄
    if (failures > MAX_FAILURES_PER_HOUR) {
      logger.warn('[IdentityBinding] 兌換失敗次數過多，不再回覆', { tenantId, channelIdentityId: actor.channelIdentityId });
      return { status: 'throttled' };
    }
    await sendBindingMessage(db, deps, tenantId, actor.conversationId, BINDING_TEXT.invalid, 'invalid');
    return { status: 'invalid' };
  };

  if ((await readCounter(deps.store, failKey)) >= MAX_FAILURES_PER_HOUR) {
    logger.warn('[IdentityBinding] 兌換失敗次數過多，略過', { tenantId, channelIdentityId: actor.channelIdentityId });
    return { status: 'throttled' };
  }

  // GETDEL：原子取出並作廢，同一代碼幾乎同時從兩個渠道送出也只有一方拿得到
  const raw = await deps.store.getdel(codeKey(tenantId, code));
  if (!raw) return fail();

  let payload: BindingCodePayload;
  try {
    payload = JSON.parse(raw) as BindingCodePayload;
  } catch {
    return fail();
  }
  if (payload.tenantId !== tenantId) return fail();

  // 沒兌換成功的情境把代碼放回去，讓真正的顧客仍可在剩餘時效內到別的渠道使用
  const putBack = async () => {
    const remaining = payload.issuedAt + BINDING_CODE_TTL_MS - now;
    if (remaining > 0) await deps.store.set(codeKey(tenantId, code), raw, 'PX', remaining, 'NX');
  };

  if (payload.channelIdentityId === actor.channelIdentityId) {
    await putBack();
    await sendBindingMessage(db, deps, tenantId, actor.conversationId, BINDING_TEXT.sameIdentity, 'same_identity');
    return { status: 'same_identity' };
  }

  const survivorId = await resolveLiveContactId(db, tenantId, payload.contactId);
  const redeemerId = await resolveLiveContactId(db, tenantId, actor.contactId);
  if (!survivorId || !redeemerId) return fail();

  if (survivorId === redeemerId) {
    await sendBindingMessage(db, deps, tenantId, actor.conversationId, BINDING_TEXT.alreadyBound, 'already_bound');
    return { status: 'already_bound' };
  }

  // 同一渠道只能有一個帳號：雙方在同一個渠道都有身分（例如代碼被轉給同一個 LINE OA 的朋友），
  // 合併後同一渠道會有兩個身分，回覆會送錯人、對話會混在一起 → 拒絕
  const [survivorChannels, redeemerChannels] = await Promise.all([
    db.channelIdentity.findMany({ where: { contactId: survivorId }, select: { channelId: true } }),
    db.channelIdentity.findMany({ where: { contactId: redeemerId }, select: { channelId: true } }),
  ]);
  const occupied = new Set(survivorChannels.map((c) => c.channelId));
  if (redeemerChannels.some((c) => occupied.has(c.channelId))) {
    await putBack();
    logger.warn('[IdentityBinding] 雙方在同一渠道都有帳號，拒絕合併', { tenantId, survivorId, redeemerId });
    await sendBindingMessage(db, deps, tenantId, actor.conversationId, BINDING_TEXT.channelConflict, 'channel_conflict');
    return { status: 'channel_conflict' };
  }

  const merge = await inTransaction(db, async (tx) => {
    const result = await mergeContacts(tx, {
      tenantId,
      survivorId,
      mergedId: redeemerId,
      source: 'BINDING_CODE',
      // 自助解除時用來判斷「顧客目前所在的身分」涉及哪一筆綁定
      meta: { issuerChannelIdentityId: payload.channelIdentityId },
    });
    await tx.identityMap.upsert({
      where: {
        tenantId_channelType_uid: { tenantId, channelType: actor.channelType as never, uid: actor.uid },
      },
      create: {
        tenantId,
        contactId: survivorId,
        channelType: actor.channelType as never,
        uid: actor.uid,
        source: 'BINDING_CODE',
        confidence: 1,
      },
      update: { contactId: survivorId, source: 'BINDING_CODE', confidence: 1, mergedAt: new Date() },
    });
    return result;
  });

  deps.io?.to(`tenant:${tenantId}`).emit('contact.merged', {
    primaryContactId: survivorId,
    secondaryContactId: redeemerId,
    primaryName: merge.survivor.displayName,
    secondaryName: merge.merged.displayName,
  });

  const settings = await getIdentityBindingSettings(db, tenantId);
  const issuerChannel = await db.channel.findFirst({ where: { id: payload.channelId, tenantId }, select: { channelType: true } });
  const unbindKeyword = settings.unbindKeywords[0];
  // 雙邊通知：兌換方與發碼方的對話各送一則
  await sendBindingMessage(
    db,
    deps,
    tenantId,
    actor.conversationId,
    BINDING_TEXT.bound(channelLabel(issuerChannel?.channelType ?? ''), unbindKeyword),
    'bound',
  );
  if (payload.conversationId !== actor.conversationId) {
    await sendBindingMessage(
      db,
      deps,
      tenantId,
      payload.conversationId,
      BINDING_TEXT.bound(channelLabel(actor.channelType), unbindKeyword),
      'bound',
    );
  }

  logger.info('[IdentityBinding] 綁定完成', { tenantId, survivorId, mergedId: redeemerId, mergeLogId: merge.mergeLogId });
  return { status: 'bound', survivorId, mergedId: redeemerId, mergeLogId: merge.mergeLogId };
}

// ── 解除 ────────────────────────────────────────────────────────────────────

/**
 * 找出與顧客「目前所在渠道身分」有關、最近一筆可自助解除的綁定（未撤銷、來源為綁定代碼）。
 * 有關＝該身分是當次被併入的身分之一，或是當次的發碼身分。只看 survivor 會拆錯筆：
 * 顧客綁了 FB 又綁了 IG，在 FB 回「解除綁定」應拆 FB 那筆，而不是最近的 IG。
 */
async function findBindingForIdentity(db: TenantDb, tenantId: string, contactId: string, channelIdentityId: string) {
  const logs = await db.contactMergeLog.findMany({
    where: { tenantId, source: 'BINDING_CODE', revertedAt: null, survivorId: contactId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return (
    logs.find((log) => {
      const moved = log.movedRecords as unknown as Partial<MovedRecords>;
      return (
        moved.channelIdentity?.includes(channelIdentityId) || moved.meta?.issuerChannelIdentityId === channelIdentityId
      );
    }) ?? null
  );
}

export type UnbindResult = { status: 'none' } | { status: 'expired' } | { status: 'unbound'; restoredContactId: string };

export async function unbindByCustomer(db: TenantDb, deps: BindingDeps, actor: BindingActor): Promise<UnbindResult> {
  const { tenantId } = actor;
  const log = await findBindingForIdentity(db, tenantId, actor.contactId, actor.channelIdentityId);
  if (!log) return { status: 'none' };

  const now = (deps.now ?? Date.now)();
  if (now - log.createdAt.getTime() > SELF_UNBIND_WINDOW_MS) {
    await sendBindingMessage(db, deps, tenantId, actor.conversationId, BINDING_TEXT.unbindExpired, 'unbind_expired');
    return { status: 'expired' };
  }

  const result = await inTransaction(db, (tx) =>
    revertMerge(tx, { tenantId, mergeLogId: log.id, revertedBy: 'customer' }),
  );

  deps.io?.to(`tenant:${tenantId}`).emit('contact.merge_reverted', {
    mergeLogId: log.id,
    survivorId: result.holderId,
    restoredContactId: result.restoredContactId,
  });

  // 雙邊通知：顧客目前的對話，以及「另一邊」聯絡人最近的對話
  await sendBindingMessage(db, deps, tenantId, actor.conversationId, BINDING_TEXT.unbound, 'unbound');
  const current = await db.conversation.findFirst({ where: { id: actor.conversationId, tenantId }, select: { contactId: true } });
  const otherContactId = current?.contactId === result.restoredContactId ? log.survivorId : result.restoredContactId;
  const moved = log.movedRecords as unknown as Partial<MovedRecords>;
  const other = await db.conversation.findFirst({
    where: {
      tenantId,
      contactId: otherContactId,
      // 優先通知當初搬移的對話；沒有就取該聯絡人最近的對話
      ...(otherContactId === result.restoredContactId && moved.conversation?.length
        ? { id: { in: moved.conversation } }
        : {}),
    },
    orderBy: { lastMessageAt: 'desc' },
    select: { id: true },
  });
  if (other && other.id !== actor.conversationId) {
    await sendBindingMessage(db, deps, tenantId, other.id, BINDING_TEXT.unbound, 'unbound');
  }

  logger.info('[IdentityBinding] 顧客自助解除綁定', { tenantId, mergeLogId: log.id });
  return { status: 'unbound', restoredContactId: result.restoredContactId };
}

// ── 入站攔截 ────────────────────────────────────────────────────────────────

export type BindingIntent =
  | { kind: 'redeem'; code: string }
  | { kind: 'issue' }
  | { kind: 'unbind' };

/**
 * 判斷一則入站訊息是否為綁定相關操作。租戶未啟用時一律回 null（行為與改版前相同）。
 * 解除關鍵字只有在確實有可解除的綁定時才算命中，否則視為一般訊息。
 */
export async function detectBindingIntent(
  db: TenantDb,
  input: {
    tenantId: string;
    contactId: string;
    text: string;
    code: string | null;
    /** 只有命中解除關鍵字時才需要（避免每則訊息都多查一次） */
    getChannelIdentityId: () => Promise<string | null>;
  },
): Promise<BindingIntent | null> {
  const settings = await getIdentityBindingSettingsCached(db, input.tenantId);
  if (!settings.enabled) return null;
  if (input.code) return { kind: 'redeem', code: input.code };

  const text = input.text.trim().toLowerCase();
  if (!text) return null;
  if (settings.bindKeywords.some((k) => k.toLowerCase() === text)) return { kind: 'issue' };
  if (settings.unbindKeywords.some((k) => k.toLowerCase() === text)) {
    const channelIdentityId = await input.getChannelIdentityId();
    if (!channelIdentityId) return null;
    const log = await findBindingForIdentity(db, input.tenantId, input.contactId, channelIdentityId);
    return log ? { kind: 'unbind' } : null;
  }
  return null;
}

export async function executeBindingIntent(
  db: TenantDb,
  deps: BindingDeps,
  actor: BindingActor,
  intent: BindingIntent,
): Promise<void> {
  if (intent.kind === 'redeem') await redeemBindingCode(db, deps, actor, intent.code);
  else if (intent.kind === 'issue') await issueBindingCode(db, deps, actor);
  else await unbindByCustomer(db, deps, actor);
}
