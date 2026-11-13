/**
 * 留言自動私訊的平台設定鍵（change add-comment-keyword-private-reply design D21、D22；
 * spec comment-reply-platform-controls「平台設定鍵有型別檢查」）。
 *
 * 寫入：平台後台經 `PUT /api/v1/platform/settings/:key`，路由呼叫 parseCommentReplySettingValue()，
 *       不合法回 400、不寫入（合法寫入沿用 setting.update 平台稽核）。
 * 讀取：租戶端（規則 API、readiness、收件、送出）與平台健康頁都呼叫 readCommentReplyPlatformSettings()；
 *       沒有設定或存的是舊的不合法值時用預設值（能力全關、測試階段開、未緊急停止、700／700／300、180 天）。
 *       平台設定是平台層表，app_tenant 有 SELECT，租戶交易內也讀得到；程序內快取 60 秒（緊急停止 60 秒內生效）。
 */
import type { Prisma } from '@prisma/client';
import { z } from 'zod/v3';
import { AppError } from '../../shared/utils/response.js';

export const COMMENT_REPLY_SETTING_KEYS = {
  capabilities: 'commentReply.capabilities',
  testPhase: 'commentReply.testPhase',
  emergencyStop: 'commentReply.emergencyStop',
  rateLimits: 'commentReply.rateLimits',
  logRetentionDays: 'commentReply.logRetentionDays',
} as const;

export type CommentReplySettingKey = (typeof COMMENT_REPLY_SETTING_KEYS)[keyof typeof COMMENT_REPLY_SETTING_KEYS];

const ALL_KEYS: readonly string[] = Object.values(COMMENT_REPLY_SETTING_KEYS);

// ─── 各鍵的型別 ──────────────────────────────────────────────────────────

const capabilitiesSchema = z
  .object({
    fbPrivateReply: z.boolean(),
    fbPostPicker: z.boolean(),
    fbPublicReply: z.boolean(),
    igPrivateReply: z.boolean(),
    igPostPicker: z.boolean(),
    igPublicReply: z.boolean(),
  })
  .strict();
export type CommentReplyCapabilityFlags = z.infer<typeof capabilitiesSchema>;
export type CommentReplyCapabilityName = keyof CommentReplyCapabilityFlags;

const testPhaseSchema = z.object({ fb: z.boolean(), ig: z.boolean() }).strict();
export type CommentReplyTestPhase = z.infer<typeof testPhaseSchema>;

const emergencyStopSchema = z
  .object({ stopped: z.boolean(), reason: z.string().max(200, '原因最多 200 字').optional() })
  .strict();
export type CommentReplyEmergencyStop = z.infer<typeof emergencyStopSchema>;

const perHour = z.number().int('請輸入整數').min(1, '最小 1').max(30000, '最大 30000');
const rateLimitsSchema = z.object({ fbPerHour: perHour, igPerHour: perHour, publicReplyPerHour: perHour }).strict();
export type CommentReplyRateLimits = z.infer<typeof rateLimitsSchema>;

const logRetentionDaysSchema = z.number().int('請輸入整數').min(30, '最少 30 天').max(730, '最多 730 天');

const SCHEMAS: Record<CommentReplySettingKey, z.ZodTypeAny> = {
  [COMMENT_REPLY_SETTING_KEYS.capabilities]: capabilitiesSchema,
  [COMMENT_REPLY_SETTING_KEYS.testPhase]: testPhaseSchema,
  [COMMENT_REPLY_SETTING_KEYS.emergencyStop]: emergencyStopSchema,
  [COMMENT_REPLY_SETTING_KEYS.rateLimits]: rateLimitsSchema,
  [COMMENT_REPLY_SETTING_KEYS.logRetentionDays]: logRetentionDaysSchema,
};

// ─── 預設值（design D21「沒有設定時」） ──────────────────────────────────

export const DEFAULT_COMMENT_REPLY_CAPABILITIES: Readonly<CommentReplyCapabilityFlags> = Object.freeze({
  fbPrivateReply: false,
  fbPostPicker: false,
  fbPublicReply: false,
  igPrivateReply: false,
  igPostPicker: false,
  igPublicReply: false,
});
export const DEFAULT_COMMENT_REPLY_TEST_PHASE: Readonly<CommentReplyTestPhase> = Object.freeze({ fb: true, ig: true });
export const DEFAULT_COMMENT_REPLY_EMERGENCY_STOP: Readonly<CommentReplyEmergencyStop> = Object.freeze({ stopped: false });
export const DEFAULT_COMMENT_REPLY_RATE_LIMITS: Readonly<CommentReplyRateLimits> = Object.freeze({
  fbPerHour: 700,
  igPerHour: 700,
  publicReplyPerHour: 300,
});
export const DEFAULT_COMMENT_REPLY_LOG_RETENTION_DAYS = 180;

export interface CommentReplyPlatformSettings {
  capabilities: CommentReplyCapabilityFlags;
  testPhase: CommentReplyTestPhase;
  emergencyStop: CommentReplyEmergencyStop;
  rateLimits: CommentReplyRateLimits;
  logRetentionDays: number;
}

// ─── 寫入前驗證（平台路由） ──────────────────────────────────────────────

export function isCommentReplySettingKey(key: string): key is CommentReplySettingKey {
  return ALL_KEYS.includes(key);
}

/**
 * @description 驗證平台設定值；不合法丟 400 VALIDATION_ERROR（details.key、details.issues），呼叫端不寫入
 * @param key 五個留言自動私訊鍵之一
 * @param value PUT 送來的 value
 * @returns 驗證後要存入的值（emergencyStop 的 reason 會去頭尾空白，空字串拿掉）
 */
export function parseCommentReplySettingValue(key: CommentReplySettingKey, value: unknown): unknown {
  const result = SCHEMAS[key].safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw new AppError(`設定值不正確：${issues[0]?.path ? `${issues[0].path} ` : ''}${issues[0]?.message ?? ''}`.trim(), 'VALIDATION_ERROR', 400, {
      key,
      issues,
    });
  }
  if (key === COMMENT_REPLY_SETTING_KEYS.emergencyStop) {
    const v = result.data as CommentReplyEmergencyStop;
    const reason = v.reason?.trim();
    return reason ? { stopped: v.stopped, reason } : { stopped: v.stopped };
  }
  return result.data;
}

export const parseCommentReplyCapabilities = (v: unknown) =>
  parseCommentReplySettingValue(COMMENT_REPLY_SETTING_KEYS.capabilities, v) as CommentReplyCapabilityFlags;
export const parseCommentReplyTestPhase = (v: unknown) =>
  parseCommentReplySettingValue(COMMENT_REPLY_SETTING_KEYS.testPhase, v) as CommentReplyTestPhase;
export const parseCommentReplyEmergencyStop = (v: unknown) =>
  parseCommentReplySettingValue(COMMENT_REPLY_SETTING_KEYS.emergencyStop, v) as CommentReplyEmergencyStop;
export const parseCommentReplyRateLimits = (v: unknown) =>
  parseCommentReplySettingValue(COMMENT_REPLY_SETTING_KEYS.rateLimits, v) as CommentReplyRateLimits;
export const parseCommentReplyLogRetentionDays = (v: unknown) =>
  parseCommentReplySettingValue(COMMENT_REPLY_SETTING_KEYS.logRetentionDays, v) as number;

// ─── 讀取（租戶端與平台共用） ────────────────────────────────────────────

/** 讀平台設定只需要 platformSetting：租戶交易（ctx.tx）、prismaAdmin 都可以傳入 */
export type PlatformSettingReader = Pick<Prisma.TransactionClient, 'platformSetting'>;

/** 程序內快取 60 秒（design D21） */
export const COMMENT_REPLY_SETTINGS_CACHE_MS = 60_000;
let cache: { at: number; value: CommentReplyPlatformSettings } | null = null;

/** 平台改了設定（同一個行程）或測試換設定時清掉快取 */
export function clearCommentReplyPlatformSettingsCache(): void {
  cache = null;
}

function safeOr<T>(schema: z.ZodTypeAny, raw: unknown, fallback: T): T {
  const r = schema.safeParse(raw);
  return r.success ? (r.data as T) : { ...(fallback as object) } as T;
}

/** 由資料庫的原始值組出設定；缺少或不合法的鍵用預設值 */
export function resolveCommentReplyPlatformSettings(raw: Partial<Record<string, unknown>>): CommentReplyPlatformSettings {
  const days = logRetentionDaysSchema.safeParse(raw[COMMENT_REPLY_SETTING_KEYS.logRetentionDays]);
  return {
    capabilities: safeOr(capabilitiesSchema, raw[COMMENT_REPLY_SETTING_KEYS.capabilities], DEFAULT_COMMENT_REPLY_CAPABILITIES),
    testPhase: safeOr(testPhaseSchema, raw[COMMENT_REPLY_SETTING_KEYS.testPhase], DEFAULT_COMMENT_REPLY_TEST_PHASE),
    emergencyStop: safeOr(emergencyStopSchema, raw[COMMENT_REPLY_SETTING_KEYS.emergencyStop], DEFAULT_COMMENT_REPLY_EMERGENCY_STOP),
    rateLimits: safeOr(rateLimitsSchema, raw[COMMENT_REPLY_SETTING_KEYS.rateLimits], DEFAULT_COMMENT_REPLY_RATE_LIMITS),
    logRetentionDays: days.success ? days.data : DEFAULT_COMMENT_REPLY_LOG_RETENTION_DAYS,
  };
}

/**
 * @description 讀留言自動私訊的平台設定（程序內快取 60 秒）
 * @param db 租戶交易或 prismaAdmin
 * @param options.fresh 略過快取（平台頁讀取等需要最新值時）
 */
export async function readCommentReplyPlatformSettings(
  db: PlatformSettingReader,
  options: { fresh?: boolean; now?: number } = {},
): Promise<CommentReplyPlatformSettings> {
  const now = options.now ?? Date.now();
  if (!options.fresh && cache && now - cache.at < COMMENT_REPLY_SETTINGS_CACHE_MS) return cache.value;
  const rows = await db.platformSetting.findMany({ where: { key: { in: [...ALL_KEYS] } }, select: { key: true, value: true } });
  const value = resolveCommentReplyPlatformSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  cache = { at: now, value };
  return value;
}

/** 外掛的平台（fb／ig）對應的能力開關名稱 */
export function capabilityName(platform: 'fb' | 'ig', kind: 'PrivateReply' | 'PostPicker' | 'PublicReply'): CommentReplyCapabilityName {
  return `${platform}${kind}` as CommentReplyCapabilityName;
}
