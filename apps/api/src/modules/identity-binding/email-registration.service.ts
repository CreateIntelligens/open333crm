/**
 * Email 登記與自動歸戶（change add-email-identity-merge，design D3 / D5）。
 *
 * 流程在 identifier-registration.ts，與手機登記共用；這裡只描述 email 的格式、比對與訊息。
 * 比對不分大小寫（客服手動輸入的 email 可能有大寫）。
 */
import { z } from 'zod';
import type { TenantDb } from '../../lib/tenant-db.js';
import type { BindingStore } from './binding-code.js';
import type { BindingActor, BindingDeps } from './binding-common.js';
import { EMAIL_TEXT } from './binding-links.js';
import { samePhone } from './phone-registration.service.js';
import {
  REGISTRATION_TTL_MS,
  describeRegistration,
  isRegistrationEnabled,
  issueRegistrationLink,
  readRegistration,
  registrationUrl,
  sendRegistrationNotices,
  submitRegistration,
  type IssueRegistrationLinkResult,
  type RegistrationDeps,
  type RegistrationKind,
  type RegistrationNotice,
  type RegistrationPayload,
  type SubmitRegistrationResult,
  valuesConflict,
} from './identifier-registration.js';

/** 登記連結有效期（design D3） */
export const EMAIL_REG_TTL_MS = REGISTRATION_TTL_MS;

export type EmailRegistrationPayload = RegistrationPayload;
export type EmailRegistrationDeps = RegistrationDeps;
export type IssueEmailLinkResult = IssueRegistrationLinkResult;
export type EmailNotice = RegistrationNotice;
export type SubmitEmailResult = Exclude<SubmitRegistrationResult, { status: 'invalid_value' }> | { status: 'invalid_email' };

const emailSchema = z.string().trim().toLowerCase().email().max(254);

/** 去除頭尾空白、轉小寫並驗證格式；不合法回 null */
export function normalizeEmail(raw: unknown): string | null {
  const parsed = emailSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export const EMAIL_REGISTRATION: RegistrationKind = {
  name: 'email',
  redisPrefix: 'emailreg',
  pathSegment: 'email',
  logTag: 'EmailRegistration',
  isEnabled: (settings) => settings.emailEnabled,
  otherIdentifierConflicts: (a, b) => valuesConflict(a.phone, b.phone, samePhone),
  normalize: normalizeEmail,
  findEarliest: (db, tenantId, email) =>
    db.contact.findFirst({
      where: { tenantId, isArchived: false, email: { equals: email, mode: 'insensitive' } },
      // 建立時間相同時以 id 排序，結果固定
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, displayName: true },
    }),
  write: async (db, tenantId, contactId, email) => {
    await db.contact.updateMany({ where: { id: contactId, tenantId }, data: { email } });
  },
  mergeSource: 'EMAIL',
  stitchSource: 'EMAIL_MATCH',
  // 送出時先寄驗證碼，驗證通過才寫入（add-coupon-system design D15）
  provesOwnership: true,
  text: EMAIL_TEXT,
};

export function emailRegistrationUrl(webBaseUrl: string, token: string): string {
  return registrationUrl(EMAIL_REGISTRATION, webBaseUrl, token);
}

/**
 * 為顧客目前的渠道身分產生登記連結，並在該對話送出。
 * @param initiatedBy 'agent'＝客服在後台代發：另計次數，超限時只回報給客服，不在顧客對話送說明
 */
export function issueEmailRegistrationLink(
  db: TenantDb,
  deps: EmailRegistrationDeps,
  actor: BindingActor,
  initiatedBy: 'customer' | 'agent' = 'customer',
): Promise<IssueEmailLinkResult> {
  return issueRegistrationLink(EMAIL_REGISTRATION, db, deps, actor, initiatedBy);
}

/** 讀取（不消耗）登記連結；不存在、過期或格式不符回 null */
export function readEmailRegistration(store: BindingStore, token: string): Promise<EmailRegistrationPayload | null> {
  return readRegistration(EMAIL_REGISTRATION, store, token);
}

/** 租戶是否啟用 email 登記（關閉後，已發出的連結也不能再用） */
export function isEmailRegistrationEnabled(db: TenantDb, tenantId: string): Promise<boolean> {
  return isRegistrationEnabled(EMAIL_REGISTRATION, db, tenantId);
}

/** 登記頁顯示的帳號資訊：只有渠道標示與顧客在該渠道的名稱，不含 email、電話等個資 */
export const describeEmailRegistration = describeRegistration;

/**
 * 送出 email：寫入聯絡人，或與相同 email 的聯絡人合併。
 * db 必須是 withTenant 的 tx（合併需要原子性）。
 */
export async function submitEmailRegistration(
  db: TenantDb,
  deps: EmailRegistrationDeps,
  token: string,
  rawEmail: unknown,
): Promise<{ result: SubmitEmailResult; notices: EmailNotice[] }> {
  const { result, notices } = await submitRegistration(EMAIL_REGISTRATION, db, deps, token, rawEmail);
  return { result: result.status === 'invalid_value' ? { status: 'invalid_email' } : result, notices };
}

/** 送出 submitEmailRegistration 回傳的通知；一則拋錯不影響其他則 */
export function sendEmailRegistrationNotices(
  db: TenantDb,
  deps: BindingDeps,
  tenantId: string,
  notices: EmailNotice[],
): Promise<void> {
  return sendRegistrationNotices(EMAIL_REGISTRATION, db, deps, tenantId, notices);
}
