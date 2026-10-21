/**
 * 識別值登記與自動歸戶的共用流程：email 與手機（change add-email-identity-merge、add-phone-identity-merge）。
 *
 * 顧客在對話取得一次性的登記連結，在登記頁填入識別值。同租戶有另一位未封存聯絡人使用相同的值時，
 * 不經人工確認直接合併（最早使用的那位為 survivor）；沒有就只把值寫到這位聯絡人。
 * email 在送出時先寄驗證碼，驗證通過才進到這裡（ownership-code.ts，add-coupon-system design D15）；
 * 手機不驗證擁有權（2026-10-14 決定）。兩者都以雙邊通知、7 天自助解除與同渠道衝突檢查降低誤併的影響。
 * 兩種登記的差異由 RegistrationKind 描述。
 */
import { randomBytes } from 'node:crypto';
import { logger } from '@open333crm/core';
import { getConfig } from '../../config/env.js';
import type { TenantDb } from '../../lib/tenant-db.js';
import type { Prisma } from '@prisma/client';
import { isSameChannelConflict, mergeContacts, type MergeSource } from '../contact/contact-merge.service.js';
import { MAX_ISSUES_PER_HOUR, bumpCounter, type BindingStore } from './binding-code.js';
import {
  hasSharedChannel,
  inTransaction,
  resolveLiveContactId,
  sendBindingMessage,
  type BindingActor,
  type BindingDeps,
} from './binding-common.js';
import { channelPublicLabel, parseIdentityBindingSettings, resolveBindingHandle, type IdentityBindingSettings } from './binding-links.js';

/** 登記連結有效期（email design D3，手機沿用） */
export const REGISTRATION_TTL_MS = 30 * 60 * 1000;

/** base64url 的 32 bytes＝43 字元；格式不符的 token 不查 Redis */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 顧客在對話看到的訊息（純文字、不放 emoji） */
export interface RegistrationText {
  invite: (url: string, minutes: number) => string;
  rateLimited: string;
  registered: string;
  channelConflict: string;
  /** 兩位聯絡人的另一種識別不一致，需要客服確認（design D6） */
  identityConflict: string;
  /** 通知登記的一方；對方沒有任何渠道時 otherLabel 為 null */
  mergedToRegistrant: (otherLabel: string | null, otherName: string, unbindKeyword: string) => string;
  /** 通知原本就使用這個值的一方 */
  mergedToExisting: (registrantLabel: string, registrantName: string, unbindKeyword: string) => string;
}

/** 一種登記（email、手機）與共用流程不同的部分 */
export interface RegistrationKind {
  /** 用於訊息種類（`${name}_invite`）、advisory lock 與 log */
  name: 'email' | 'phone';
  /** Redis key 前綴 */
  redisPrefix: string;
  /** 登記頁路徑：`/bind/${pathSegment}/{token}` */
  pathSegment: string;
  logTag: string;
  isEnabled: (settings: IdentityBindingSettings) => boolean;
  /** 檢查並統一格式；不合法回 null */
  normalize: (raw: unknown) => string | null;
  /** 最早使用這個值的未封存聯絡人（含登記方自己） */
  findEarliest: (db: TenantDb, tenantId: string, value: string) => Promise<{ id: string; displayName: string } | null>;
  write: (db: TenantDb, tenantId: string, contactId: string, value: string) => Promise<void>;
  /**
   * 兩位聯絡人的另一種識別（email 登記看電話、手機登記看 email）是否矛盾：兩邊都有值且不同。
   * 矛盾時不自動合併（add-phone-identity-merge design D6）
   */
  otherIdentifierConflicts: (registrant: ContactIdentifiers, existing: ContactIdentifiers) => boolean;
  mergeSource: MergeSource;
  stitchSource: 'EMAIL_MATCH' | 'PHONE_MATCH';
  text: RegistrationText;
}

export interface ContactIdentifiers {
  email: string | null;
  phone: string | null;
}

/** 兩邊都有值、且依 same 比較後不同 */
export function valuesConflict(a: string | null, b: string | null, same: (x: string, y: string) => boolean): boolean {
  const x = a?.trim();
  const y = b?.trim();
  return Boolean(x) && Boolean(y) && !same(x!, y!);
}

export interface RegistrationPayload {
  tenantId: string;
  channelIdentityId: string;
  channelId: string;
  conversationId: string;
  issuedAt: number;
}

export interface RegistrationDeps extends BindingDeps {
  /** 登記頁網址的前綴；預設為 WEB_BASE_URL */
  webBaseUrl?: string;
}

export type IssueRegistrationLinkResult = { status: 'sent' } | { status: 'rate_limited' } | { status: 'delivery_failed' };

const tokenKey = (kind: RegistrationKind, token: string) => `${kind.redisPrefix}:${token}`;
const issueKey = (kind: RegistrationKind, channelIdentityId: string, initiatedBy: 'customer' | 'agent') =>
  `${kind.redisPrefix}:issue:${channelIdentityId}${initiatedBy === 'agent' ? ':agent' : ''}`;

export function registrationUrl(kind: RegistrationKind, webBaseUrl: string, token: string): string {
  return `${webBaseUrl.replace(/\/+$/, '')}/bind/${kind.pathSegment}/${token}`;
}

/**
 * 產生登記權杖（不送訊息）。與對話中發連結共用每小時次數上限。
 * 優惠券票券夾用它把未歸戶的顧客直接帶到登記頁（add-coupon-system design D12）。
 */
export async function issueRegistrationToken(
  kind: RegistrationKind,
  deps: RegistrationDeps,
  actor: Pick<BindingActor, 'tenantId' | 'channelIdentityId' | 'channelId' | 'conversationId'>,
  initiatedBy: 'customer' | 'agent' = 'customer',
): Promise<{ status: 'ok'; token: string; issued: number } | { status: 'rate_limited'; issued: number }> {
  const issued = await bumpCounter(deps.store, issueKey(kind, actor.channelIdentityId, initiatedBy));
  if (issued > MAX_ISSUES_PER_HOUR) return { status: 'rate_limited', issued };

  const token = randomBytes(32).toString('base64url');
  const payload: RegistrationPayload = {
    tenantId: actor.tenantId,
    channelIdentityId: actor.channelIdentityId,
    channelId: actor.channelId,
    conversationId: actor.conversationId,
    issuedAt: (deps.now ?? Date.now)(),
  };
  await deps.store.set(tokenKey(kind, token), JSON.stringify(payload), 'PX', REGISTRATION_TTL_MS, 'NX');
  return { status: 'ok', token, issued };
}

/** 重用登記權杖時至少要剩下的有效期：顧客要有時間填寫與收驗證信 */
const REUSE_MIN_REMAINING_MS = 10 * 60 * 1000;
const reuseKey = (kind: RegistrationKind, channelIdentityId: string) => `${kind.redisPrefix}:reuse:${channelIdentityId}`;

/**
 * 取得登記權杖：同一個渠道身分還有夠長效期的權杖就重用，否則產生新的。
 * 顧客重新整理票券頁不會每次都產生新權杖、很快碰到每小時上限。
 */
export async function reuseOrIssueRegistrationToken(
  kind: RegistrationKind,
  deps: RegistrationDeps,
  actor: Pick<BindingActor, 'tenantId' | 'channelIdentityId' | 'channelId' | 'conversationId'>,
): Promise<{ status: 'ok'; token: string } | { status: 'rate_limited' }> {
  const key = reuseKey(kind, actor.channelIdentityId);
  const previous = await deps.store.get(key);
  if (previous && (await deps.store.pttl(tokenKey(kind, previous))) > REUSE_MIN_REMAINING_MS) {
    const payload = await readRegistration(kind, deps.store, previous);
    if (payload?.tenantId === actor.tenantId) return { status: 'ok', token: previous };
  }
  const issued = await issueRegistrationToken(kind, deps, actor);
  if (issued.status === 'rate_limited') return issued;
  await deps.store.getdel(key);
  await deps.store.set(key, issued.token, 'PX', REGISTRATION_TTL_MS - REUSE_MIN_REMAINING_MS, 'NX');
  return { status: 'ok', token: issued.token };
}

/**
 * 為顧客目前的渠道身分產生登記連結，並在該對話送出。
 * @param initiatedBy 'agent'＝客服在後台代發：另計次數，超限時只回報給客服，不在顧客對話送說明
 */
export async function issueRegistrationLink(
  kind: RegistrationKind,
  db: TenantDb,
  deps: RegistrationDeps,
  actor: BindingActor,
  initiatedBy: 'customer' | 'agent' = 'customer',
): Promise<IssueRegistrationLinkResult> {
  const { tenantId } = actor;
  const issuedToken = await issueRegistrationToken(kind, deps, actor, initiatedBy);
  if (issuedToken.status === 'rate_limited') {
    // 只在第一次超過時回覆：每則回覆都佔推播額度，否則可被拿來洗訊息
    if (initiatedBy === 'customer' && issuedToken.issued === MAX_ISSUES_PER_HOUR + 1) {
      await sendBindingMessage(db, deps, tenantId, actor.conversationId, kind.text.rateLimited, `${kind.name}_rate_limited`);
    }
    return { status: 'rate_limited' };
  }
  const { token } = issuedToken;

  const url = registrationUrl(kind, deps.webBaseUrl ?? getConfig().WEB_BASE_URL, token);
  const text = kind.text.invite(url, Math.round(REGISTRATION_TTL_MS / 60000));
  const delivered = await sendBindingMessage(db, deps, tenantId, actor.conversationId, text, `${kind.name}_invite`);
  if (!delivered) {
    // 顧客沒收到就作廢，並如實回報（客服代發按鈕不可顯示成功）
    await deps.store.getdel(tokenKey(kind, token));
    return { status: 'delivery_failed' };
  }
  logger.info(`[${kind.logTag}] 已發出登記連結`, { tenantId, channelIdentityId: actor.channelIdentityId });
  return { status: 'sent' };
}

function parsePayload(raw: string | null): RegistrationPayload | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as RegistrationPayload;
    // 缺發出時間就算不出剩餘有效期，送出失敗時無法放回連結
    return typeof p.tenantId === 'string' && typeof p.channelIdentityId === 'string' && Number.isFinite(p.issuedAt)
      ? p
      : null;
  } catch {
    return null;
  }
}

/** 讀取（不消耗）登記連結；不存在、過期或格式不符回 null */
export async function readRegistration(
  kind: RegistrationKind,
  store: BindingStore,
  token: string,
): Promise<RegistrationPayload | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  return parsePayload(await store.get(tokenKey(kind, token)));
}

/** 租戶是否啟用這種登記（關閉後，已發出的連結也不能再用） */
export async function isRegistrationEnabled(kind: RegistrationKind, db: TenantDb, tenantId: string): Promise<boolean> {
  const row = await db.tenantSettings.findFirst({ where: { tenantId }, select: { identityBinding: true } });
  return kind.isEnabled(parseIdentityBindingSettings(row?.identityBinding));
}

/** 登記頁顯示的帳號資訊：只有渠道標示與顧客在該渠道的名稱，不含 email、電話等個資 */
export async function describeRegistration(
  db: TenantDb,
  payload: RegistrationPayload,
): Promise<{ channelType: string; channelLabel: string; profileName: string } | null> {
  const identity = await db.channelIdentity.findFirst({
    where: { id: payload.channelIdentityId, contact: { tenantId: payload.tenantId } },
    select: {
      profileName: true,
      channelType: true,
      channel: { select: { settings: true } },
      contact: { select: { displayName: true } },
    },
  });
  if (!identity) return null;
  return {
    channelType: identity.channelType,
    channelLabel: channelPublicLabel(identity.channelType, resolveBindingHandle(identity.channel.settings)),
    profileName: identity.profileName || identity.contact.displayName || '',
  };
}

/** 送出後要在對話中送出的訊息（與資料寫入分開，見 sendRegistrationNotices） */
export interface RegistrationNotice {
  conversationId: string;
  text: string;
  kind: string;
}

export type SubmitRegistrationResult =
  | { status: 'invalid_value' }
  | { status: 'expired' }
  | { status: 'registered'; contactId: string }
  | { status: 'channel_conflict' }
  | { status: 'identity_conflict' }
  | { status: 'merged'; survivorId: string; mergedId: string; mergeLogId: string };

/**
 * 送出識別值：寫入聯絡人，或與使用相同值的聯絡人合併。
 * 回傳要送出的通知；呼叫端在交易結束後以 sendRegistrationNotices 送出，避免推播拖長交易。
 *
 * db 必須是 withTenant 的 tx（合併需要原子性）。
 */
export async function submitRegistration(
  kind: RegistrationKind,
  db: TenantDb,
  deps: RegistrationDeps,
  token: string,
  rawValue: unknown,
): Promise<{ result: SubmitRegistrationResult; notices: RegistrationNotice[] }> {
  const none = (result: SubmitRegistrationResult) => ({ result, notices: [] });
  const peek = await readRegistration(kind, deps.store, token);
  if (!peek) return none({ status: 'expired' });
  // 格式錯誤不消耗連結，顧客改正後可再送
  const value = kind.normalize(rawValue);
  if (!value) return none({ status: 'invalid_value' });

  // 此時才原子取出：同一個連結並行送出時只有一個成功
  const raw = await deps.store.getdel(tokenKey(kind, token));
  const payload = parsePayload(raw);
  if (!raw || !payload) return none({ status: 'expired' });

  const restore = async () => {
    const remaining = payload.issuedAt + REGISTRATION_TTL_MS - (deps.now ?? Date.now)();
    if (remaining > 0) await deps.store.set(tokenKey(kind, token), raw, 'PX', remaining, 'NX');
  };
  try {
    return await register(kind, db, payload, value);
  } catch (err) {
    // 寫入或合併失敗（例如同時有客服在合併同一位聯絡人）：放回連結，顧客可以再送一次
    await restore();
    throw err;
  }
}

async function register(
  kind: RegistrationKind,
  db: TenantDb,
  payload: RegistrationPayload,
  value: string,
): Promise<{ result: SubmitRegistrationResult; notices: RegistrationNotice[] }> {
  const { tenantId } = payload;
  const identity = await db.channelIdentity.findFirst({
    where: { id: payload.channelIdentityId, contact: { tenantId } },
    select: {
      contactId: true,
      uid: true,
      channelType: true,
      profileName: true,
      channel: { select: { settings: true } },
    },
  });
  if (!identity) return { result: { status: 'expired' }, notices: [] };
  // 身分在發連結之後可能被併入別人：以目前持有它的聯絡人為準
  const registrantId = await resolveLiveContactId(db, tenantId, identity.contactId);
  if (!registrantId) return { result: { status: 'expired' }, notices: [] };
  const conversationId = payload.conversationId;

  // 同一個值的登記依序處理（AUDIT IDENT-04）：沒有這個鎖時，兩位聯絡人同時登記一個新的值，
  // 兩邊都查不到使用者、都寫入但不合併。鎖在交易結束時釋放，db 必須是 withTenant 的 tx。
  // 以統一格式後的值為 key：同一支手機寫成不同格式也會依序處理
  const lockKey = `${kind.name}-registration:${tenantId}:${value}`;
  await (db as Prisma.TransactionClient).$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

  // 最早使用這個值的聯絡人代表這個 One ID（含登記方自己）：登記方就是最早的一位時不合併，
  // 否則會把最早的一位併入較新的一位
  const earliest = await kind.findEarliest(db, tenantId, value);
  const existing = earliest && earliest.id !== registrantId ? earliest : null;

  if (!existing) {
    await kind.write(db, tenantId, registrantId, value);
    await markIdentityVerified(kind, db, tenantId, registrantId);
    return {
      result: { status: 'registered', contactId: registrantId },
      notices: [{ conversationId, text: kind.text.registered, kind: `${kind.name}_registered` }],
    };
  }

  const channelConflict = (): { result: SubmitRegistrationResult; notices: RegistrationNotice[] } => {
    logger.warn(`[${kind.logTag}] 雙方在同一渠道都有帳號，拒絕合併`, { tenantId, existingId: existing.id, registrantId });
    return {
      result: { status: 'channel_conflict' },
      notices: [{ conversationId, text: kind.text.channelConflict, kind: `${kind.name}_channel_conflict` }],
    };
  };
  if (await hasSharedChannel(db, existing.id, registrantId)) return channelConflict();

  // 另一種識別矛盾：可能是不同的人（共用號碼的家人），也可能是兩組各自歸戶過的資料，交給客服確認。
  // 不寫入，否則兩位未封存的聯絡人會使用同一個值
  const [registrantIds, existingIds] = await Promise.all(
    [registrantId, existing.id].map((id) =>
      db.contact.findFirst({ where: { id, tenantId }, select: { email: true, phone: true } }),
    ),
  );
  if (registrantIds && existingIds && kind.otherIdentifierConflicts(registrantIds, existingIds)) {
    logger.warn(`[${kind.logTag}] 另一種識別不一致，不自動合併`, { tenantId, existingId: existing.id, registrantId });
    return {
      result: { status: 'identity_conflict' },
      notices: [{ conversationId, text: kind.text.identityConflict, kind: `${kind.name}_identity_conflict` }],
    };
  }

  // 合併前先找既有方最近的對話：合併後登記方的對話也會屬於既有方
  const existingConversation = await db.conversation.findFirst({
    where: { tenantId, contactId: existing.id },
    orderBy: { lastMessageAt: 'desc' },
    select: { id: true, channelId: true, channelType: true, channel: { select: { settings: true } } },
  });
  const notifiedIdentity = existingConversation
    ? await db.channelIdentity.findFirst({
        where: { contactId: existing.id, channelId: existingConversation.channelId },
        select: { id: true, profileName: true },
      })
    : null;

  // 上面的檢查與合併之間，另一個合併可能剛把同渠道的身分併進既有方：引擎鎖定後再檢查一次並拒絕，
  // 比照上面的檢查回覆顧客（引擎已還原被合併方，交易可照常提交）
  const merge = await inTransaction(db, async (tx) => {
    const result = await mergeContacts(tx, {
      tenantId,
      survivorId: existing.id,
      mergedId: registrantId,
      source: kind.mergeSource,
      meta: {
        registrantChannelIdentityId: payload.channelIdentityId,
        ...(notifiedIdentity ? { notifiedChannelIdentityId: notifiedIdentity.id } : {}),
      },
    });
    await tx.identityMap.upsert({
      where: { tenantId_channelType_uid: { tenantId, channelType: identity.channelType, uid: identity.uid } },
      create: {
        tenantId,
        contactId: existing.id,
        channelType: identity.channelType,
        uid: identity.uid,
        source: kind.stitchSource,
        confidence: 1,
      },
      update: { contactId: existing.id, source: kind.stitchSource, confidence: 1, mergedAt: new Date() },
    });
    return result;
  }).catch((err: unknown) => {
    if (isSameChannelConflict(err)) return null;
    throw err;
  });
  if (!merge) return channelConflict();
  await markIdentityVerified(kind, db, tenantId, existing.id);

  const settingsRow = await db.tenantSettings.findFirst({ where: { tenantId }, select: { identityBinding: true } });
  const unbindKeyword = parseIdentityBindingSettings(settingsRow?.identityBinding).unbindKeywords[0];
  const registrantLabel = channelPublicLabel(identity.channelType, resolveBindingHandle(identity.channel.settings));
  const registrantName = identity.profileName || merge.merged.displayName || '未命名';
  const existingLabel = existingConversation
    ? channelPublicLabel(existingConversation.channelType, resolveBindingHandle(existingConversation.channel.settings))
    : null;
  const existingName = notifiedIdentity?.profileName || existing.displayName || '未命名';

  const notices: RegistrationNotice[] = [
    {
      conversationId,
      text: kind.text.mergedToRegistrant(existingLabel, existingName, unbindKeyword),
      kind: `${kind.name}_merged`,
    },
  ];
  if (existingConversation && existingConversation.id !== conversationId) {
    notices.push({
      conversationId: existingConversation.id,
      text: kind.text.mergedToExisting(registrantLabel, registrantName, unbindKeyword),
      kind: `${kind.name}_merged`,
    });
  }
  logger.info(`[${kind.logTag}] 依相同的值合併`, { tenantId, survivorId: existing.id, mergedId: registrantId, mergeLogId: merge.mergeLogId });
  return {
    result: { status: 'merged', survivorId: existing.id, mergedId: registrantId, mergeLogId: merge.mergeLogId },
    notices,
  };
}

/**
 * 記錄歸戶驗證：顧客本人用登記連結送出了這個值。優惠券票券夾以此判斷是否已歸戶（add-coupon-system D12）。
 * 合併時記在保留方——合併後顧客的所有渠道身分都屬於它。
 */
async function markIdentityVerified(kind: RegistrationKind, db: TenantDb, tenantId: string, contactId: string): Promise<void> {
  await db.contact.updateMany({
    where: { id: contactId, tenantId },
    data: { identityVerifiedAt: new Date(), identityVerifiedVia: kind.name },
  });
}

/**
 * 送出 submitRegistration 回傳的通知。送不出去的訊息會在對話標示「沒有送出」，合併結果不受影響。
 * 每則各自處理：一則拋錯不影響其他則。
 */
export async function sendRegistrationNotices(
  kind: RegistrationKind,
  db: TenantDb,
  deps: BindingDeps,
  tenantId: string,
  notices: RegistrationNotice[],
): Promise<void> {
  for (const n of notices) {
    try {
      await sendBindingMessage(db, deps, tenantId, n.conversationId, n.text, n.kind);
    } catch (err) {
      logger.error(`[${kind.logTag}] 通知送出失敗（conversation=${n.conversationId}, kind=${n.kind}）:`, err);
    }
  }
}
