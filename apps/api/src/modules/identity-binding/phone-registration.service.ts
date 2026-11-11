/**
 * 手機登記與自動歸戶（change add-phone-identity-merge）。
 *
 * 流程在 identifier-registration.ts，與 email 登記共用；這裡只描述手機的格式、比對與訊息。
 * 只接受台灣手機，統一存成 09 開頭的 10 位數字（design D3）。
 */
import { Prisma } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import type { BindingStore } from './binding-code.js';
import type { BindingActor, BindingDeps } from './binding-common.js';
import { PHONE_TEXT } from './binding-links.js';
import {
  REGISTRATION_TTL_MS,
  describeRegistration,
  isRegistrationEnabled,
  issueRegistrationLink,
  readRegistration,
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

export const PHONE_REG_TTL_MS = REGISTRATION_TTL_MS;

/**
 * 台灣手機號碼統一成 `09xxxxxxxx`；其他號碼（市話、國外、含分機）回 null。
 * 接受 09 開頭 10 碼，或 +886／886 後接 9 或 09 開頭的同一支手機；可夾空白、-、( )。
 */
export function normalizeTaiwanMobile(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 30) return null;
  const s = raw.replace(/[\s\-()]/g, '');
  if (/^09\d{8}$/.test(s)) return s;
  const intl = /^\+?886(0?9\d{8})$/.exec(s);
  if (!intl) return null;
  return intl[1].startsWith('0') ? intl[1] : `0${intl[1]}`;
}

/** 兩個電話是否同一支：台灣手機比統一格式，其他號碼只比數字 */
export function samePhone(a: string, b: string): boolean {
  const key = (v: string) => normalizeTaiwanMobile(v) ?? v.replace(/\D/g, '');
  return key(a) === key(b);
}

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const PHONE_REGISTRATION: RegistrationKind = {
  name: 'phone',
  redisPrefix: 'phonereg',
  pathSegment: 'phone',
  logTag: 'PhoneRegistration',
  isEnabled: (settings) => settings.phoneEnabled,
  otherIdentifierConflicts: (a, b) => valuesConflict(a.email, b.email, sameEmail),
  normalize: normalizeTaiwanMobile,
  findEarliest: async (db, tenantId, phone) => {
    const rows = await (db as Prisma.TransactionClient).$queryRaw<Array<{ id: string; displayName: string }>>`
      SELECT c.id, c."displayName" FROM contacts c
      CROSS JOIN LATERAL (SELECT regexp_replace(c.phone, '[^0-9]', '', 'g') AS d) n
      WHERE c."tenantId" = ${tenantId}::uuid AND c."isArchived" = false AND c.phone IS NOT NULL
        AND ${PHONE_SQL} = ${phone}
      ORDER BY c."createdAt" ASC, c.id ASC
      LIMIT 1`;
    return rows[0] ?? null;
  },
  write: async (db, tenantId, contactId, phone) => {
    await db.contact.updateMany({ where: { id: contactId, tenantId }, data: { phone } });
  },
  mergeSource: 'PHONE',
  stitchSource: 'PHONE_MATCH',
  // 沒有簡訊驗證：只用於歸戶，不算歸戶驗證
  provesOwnership: false,
  text: PHONE_TEXT,
};

/**
 * 既有電話在 SQL 端統一格式（design D3）：客服或匯入存的電話是自由格式（`0912-345-678`、`+886 912 345 678`）。
 * `n.d` 是只留數字的電話；886 國碼換成 0。不是台灣手機時為 NULL，含分機的電話位數不符也是 NULL。
 */
const PHONE_SQL = Prisma.sql`(
  CASE
    WHEN n.d ~ '^09[0-9]{8}$' THEN n.d
    WHEN n.d ~ '^8869[0-9]{8}$' THEN '0' || substr(n.d, 4)
    WHEN n.d ~ '^88609[0-9]{8}$' THEN substr(n.d, 4)
  END
)`;

export type PhoneRegistrationPayload = RegistrationPayload;
export type PhoneRegistrationDeps = RegistrationDeps;
export type PhoneNotice = RegistrationNotice;
export type SubmitPhoneResult = Exclude<SubmitRegistrationResult, { status: 'invalid_value' }> | { status: 'invalid_phone' };

export function issuePhoneRegistrationLink(
  db: TenantDb,
  deps: PhoneRegistrationDeps,
  actor: BindingActor,
  initiatedBy: 'customer' | 'agent' = 'customer',
): Promise<IssueRegistrationLinkResult> {
  return issueRegistrationLink(PHONE_REGISTRATION, db, deps, actor, initiatedBy);
}

export function readPhoneRegistration(store: BindingStore, token: string): Promise<PhoneRegistrationPayload | null> {
  return readRegistration(PHONE_REGISTRATION, store, token);
}

export function isPhoneRegistrationEnabled(db: TenantDb, tenantId: string): Promise<boolean> {
  return isRegistrationEnabled(PHONE_REGISTRATION, db, tenantId);
}

export const describePhoneRegistration = describeRegistration;

/**
 * 送出手機號碼：寫入聯絡人，或與相同手機的聯絡人合併。
 * db 必須是 withTenant 的 tx（合併需要原子性）。
 */
export async function submitPhoneRegistration(
  db: TenantDb,
  deps: PhoneRegistrationDeps,
  token: string,
  rawPhone: unknown,
): Promise<{ result: SubmitPhoneResult; notices: PhoneNotice[] }> {
  const { result, notices } = await submitRegistration(PHONE_REGISTRATION, db, deps, token, rawPhone);
  return { result: result.status === 'invalid_value' ? { status: 'invalid_phone' } : result, notices };
}

export function sendPhoneRegistrationNotices(
  db: TenantDb,
  deps: BindingDeps,
  tenantId: string,
  notices: PhoneNotice[],
): Promise<void> {
  return sendRegistrationNotices(PHONE_REGISTRATION, db, deps, tenantId, notices);
}
