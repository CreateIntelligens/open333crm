/**
 * Email 登記與自動歸戶（change add-email-identity-merge，design D3 / D5）。
 *
 * 顧客在對話取得一次性的登記連結，在登記頁填入 email。同租戶有另一位未封存聯絡人使用相同 email 時，
 * 不經人工確認直接合併（既有那位為 survivor）；沒有就只把 email 寫到這位聯絡人。
 * 不驗證 email 擁有權（2026-10-07 決定），以雙邊通知、7 天自助解除與同渠道衝突檢查降低誤併的影響。
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { logger } from '@open333crm/core';
import { getConfig } from '../../config/env.js';
import type { TenantDb } from '../../lib/tenant-db.js';
import { mergeContacts } from '../contact/contact-merge.service.js';
import { MAX_ISSUES_PER_HOUR, bumpCounter, type BindingStore } from './binding-code.js';
import {
  hasSharedChannel,
  inTransaction,
  resolveLiveContactId,
  sendBindingMessage,
  type BindingActor,
  type BindingDeps,
} from './binding-common.js';
import { EMAIL_TEXT, channelPublicLabel, parseIdentityBindingSettings, resolveBindingHandle } from './binding-links.js';

/** 登記連結有效期（design D3） */
export const EMAIL_REG_TTL_MS = 30 * 60 * 1000;

/** base64url 的 32 bytes＝43 字元；格式不符的 token 不查 Redis */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const tokenKey = (token: string) => `emailreg:${token}`;
const issueKey = (channelIdentityId: string, initiatedBy: 'customer' | 'agent') =>
  `emailreg:issue:${channelIdentityId}${initiatedBy === 'agent' ? ':agent' : ''}`;

export interface EmailRegistrationPayload {
  tenantId: string;
  channelIdentityId: string;
  channelId: string;
  conversationId: string;
  issuedAt: number;
}

export interface EmailRegistrationDeps extends BindingDeps {
  /** 登記頁網址的前綴；預設為 WEB_BASE_URL */
  webBaseUrl?: string;
}

export type IssueEmailLinkResult = { status: 'sent' } | { status: 'rate_limited' } | { status: 'delivery_failed' };

export function emailRegistrationUrl(webBaseUrl: string, token: string): string {
  return `${webBaseUrl.replace(/\/+$/, '')}/bind/email/${token}`;
}

/**
 * 為顧客目前的渠道身分產生登記連結，並在該對話送出。
 * @param initiatedBy 'agent'＝客服在後台代發：另計次數，超限時只回報給客服，不在顧客對話送說明
 */
export async function issueEmailRegistrationLink(
  db: TenantDb,
  deps: EmailRegistrationDeps,
  actor: BindingActor,
  initiatedBy: 'customer' | 'agent' = 'customer',
): Promise<IssueEmailLinkResult> {
  const { tenantId } = actor;
  const issued = await bumpCounter(deps.store, issueKey(actor.channelIdentityId, initiatedBy));
  if (issued > MAX_ISSUES_PER_HOUR) {
    // 只在第一次超過時回覆：每則回覆都佔推播額度，否則可被拿來洗訊息
    if (initiatedBy === 'customer' && issued === MAX_ISSUES_PER_HOUR + 1) {
      await sendBindingMessage(db, deps, tenantId, actor.conversationId, EMAIL_TEXT.rateLimited, 'email_rate_limited');
    }
    return { status: 'rate_limited' };
  }

  const token = randomBytes(32).toString('base64url');
  const payload: EmailRegistrationPayload = {
    tenantId,
    channelIdentityId: actor.channelIdentityId,
    channelId: actor.channelId,
    conversationId: actor.conversationId,
    issuedAt: (deps.now ?? Date.now)(),
  };
  await deps.store.set(tokenKey(token), JSON.stringify(payload), 'PX', EMAIL_REG_TTL_MS, 'NX');

  const url = emailRegistrationUrl(deps.webBaseUrl ?? getConfig().WEB_BASE_URL, token);
  const text = EMAIL_TEXT.invite(url, Math.round(EMAIL_REG_TTL_MS / 60000));
  const delivered = await sendBindingMessage(db, deps, tenantId, actor.conversationId, text, 'email_invite');
  if (!delivered) {
    // 顧客沒收到就作廢，並如實回報（客服代發按鈕不可顯示成功）
    await deps.store.getdel(tokenKey(token));
    return { status: 'delivery_failed' };
  }
  logger.info('[EmailRegistration] 已發出登記連結', { tenantId, channelIdentityId: actor.channelIdentityId });
  return { status: 'sent' };
}

function parsePayload(raw: string | null): EmailRegistrationPayload | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as EmailRegistrationPayload;
    return typeof p.tenantId === 'string' && typeof p.channelIdentityId === 'string' ? p : null;
  } catch {
    return null;
  }
}

/** 讀取（不消耗）登記連結；不存在、過期或格式不符回 null */
export async function readEmailRegistration(store: BindingStore, token: string): Promise<EmailRegistrationPayload | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  return parsePayload(await store.get(tokenKey(token)));
}

/** 租戶是否啟用 email 登記（關閉後，已發出的連結也不能再用） */
export async function isEmailRegistrationEnabled(db: TenantDb, tenantId: string): Promise<boolean> {
  const row = await db.tenantSettings.findFirst({ where: { tenantId }, select: { identityBinding: true } });
  return parseIdentityBindingSettings(row?.identityBinding).emailEnabled;
}

/** 登記頁顯示的帳號資訊：只有渠道標示與顧客在該渠道的名稱，不含 email、電話等個資 */
export async function describeEmailRegistration(
  db: TenantDb,
  payload: EmailRegistrationPayload,
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

const emailSchema = z.string().trim().toLowerCase().email().max(254);

/** 去除頭尾空白、轉小寫並驗證格式；不合法回 null */
export function normalizeEmail(raw: unknown): string | null {
  const parsed = emailSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** 送出 email 後要在對話中送出的訊息（與資料寫入分開，見 sendEmailRegistrationNotices） */
export interface EmailNotice {
  conversationId: string;
  text: string;
  kind: string;
}

export type SubmitEmailResult =
  | { status: 'invalid_email' }
  | { status: 'expired' }
  | { status: 'registered'; contactId: string }
  | { status: 'channel_conflict' }
  | { status: 'merged'; survivorId: string; mergedId: string; mergeLogId: string };

/**
 * 送出 email：寫入聯絡人，或與相同 email 的聯絡人合併。
 * 回傳要送出的通知；呼叫端在交易結束後以 sendEmailRegistrationNotices 送出，避免推播拖長交易。
 *
 * db 必須是 withTenant 的 tx（合併需要原子性）。
 */
export async function submitEmailRegistration(
  db: TenantDb,
  deps: EmailRegistrationDeps,
  token: string,
  rawEmail: unknown,
): Promise<{ result: SubmitEmailResult; notices: EmailNotice[] }> {
  const none = (result: SubmitEmailResult) => ({ result, notices: [] });
  const peek = await readEmailRegistration(deps.store, token);
  if (!peek) return none({ status: 'expired' });
  // 格式錯誤不消耗連結，顧客改正後可再送
  const email = normalizeEmail(rawEmail);
  if (!email) return none({ status: 'invalid_email' });

  // 此時才原子取出：同一個連結並行送出時只有一個成功
  const raw = await deps.store.getdel(tokenKey(token));
  const payload = parsePayload(raw);
  if (!raw || !payload) return none({ status: 'expired' });

  const restore = async () => {
    const remaining = payload.issuedAt + EMAIL_REG_TTL_MS - (deps.now ?? Date.now)();
    if (remaining > 0) await deps.store.set(tokenKey(token), raw, 'PX', remaining, 'NX');
  };
  try {
    return await registerEmail(db, payload, email);
  } catch (err) {
    // 寫入或合併失敗（例如同時有客服在合併同一位聯絡人）：放回連結，顧客可以再送一次
    await restore();
    throw err;
  }
}

async function registerEmail(
  db: TenantDb,
  payload: EmailRegistrationPayload,
  email: string,
): Promise<{ result: SubmitEmailResult; notices: EmailNotice[] }> {
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

  // 最早使用這個 email 的聯絡人代表這個 One ID（含登記方自己）：登記方就是最早的一位時不合併，
  // 否則會把最早的一位併入較新的一位
  const earliest = await db.contact.findFirst({
    where: { tenantId, isArchived: false, email: { equals: email, mode: 'insensitive' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, displayName: true },
  });
  const existing = earliest && earliest.id !== registrantId ? earliest : null;

  if (!existing) {
    await db.contact.updateMany({ where: { id: registrantId, tenantId }, data: { email } });
    return {
      result: { status: 'registered', contactId: registrantId },
      notices: [{ conversationId, text: EMAIL_TEXT.registered, kind: 'email_registered' }],
    };
  }

  if (await hasSharedChannel(db, existing.id, registrantId)) {
    logger.warn('[EmailRegistration] 雙方在同一渠道都有帳號，拒絕合併', { tenantId, existingId: existing.id, registrantId });
    return {
      result: { status: 'channel_conflict' },
      notices: [{ conversationId, text: EMAIL_TEXT.channelConflict, kind: 'email_channel_conflict' }],
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

  const merge = await inTransaction(db, async (tx) => {
    const result = await mergeContacts(tx, {
      tenantId,
      survivorId: existing.id,
      mergedId: registrantId,
      source: 'EMAIL',
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
        source: 'EMAIL_MATCH',
        confidence: 1,
      },
      update: { contactId: existing.id, source: 'EMAIL_MATCH', confidence: 1, mergedAt: new Date() },
    });
    return result;
  });

  const settingsRow = await db.tenantSettings.findFirst({ where: { tenantId }, select: { identityBinding: true } });
  const unbindKeyword = parseIdentityBindingSettings(settingsRow?.identityBinding).unbindKeywords[0];
  const registrantLabel = channelPublicLabel(identity.channelType, resolveBindingHandle(identity.channel.settings));
  const registrantName = identity.profileName || merge.merged.displayName || '未命名';
  const existingLabel = existingConversation
    ? channelPublicLabel(existingConversation.channelType, resolveBindingHandle(existingConversation.channel.settings))
    : null;
  const existingName = notifiedIdentity?.profileName || existing.displayName || '未命名';

  const notices: EmailNotice[] = [
    { conversationId, text: EMAIL_TEXT.mergedToRegistrant(existingLabel, existingName, unbindKeyword), kind: 'email_merged' },
  ];
  if (existingConversation && existingConversation.id !== conversationId) {
    notices.push({
      conversationId: existingConversation.id,
      text: EMAIL_TEXT.mergedToExisting(registrantLabel, registrantName, unbindKeyword),
      kind: 'email_merged',
    });
  }
  logger.info('[EmailRegistration] 依相同 email 合併', { tenantId, survivorId: existing.id, mergedId: registrantId, mergeLogId: merge.mergeLogId });
  return {
    result: { status: 'merged', survivorId: existing.id, mergedId: registrantId, mergeLogId: merge.mergeLogId },
    notices,
  };
}

/**
 * 送出 submitEmailRegistration 回傳的通知。送不出去的訊息會在對話標示「沒有送出」，合併結果不受影響。
 */
export async function sendEmailRegistrationNotices(
  db: TenantDb,
  deps: BindingDeps,
  tenantId: string,
  notices: EmailNotice[],
): Promise<void> {
  for (const n of notices) {
    await sendBindingMessage(db, deps, tenantId, n.conversationId, n.text, n.kind);
  }
}
