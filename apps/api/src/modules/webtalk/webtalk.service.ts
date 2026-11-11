/**
 * WebTalk 協作工具列的租戶隔離（change webtalk-multi-tenant）。
 *
 * WebTalk SDK 沒有伺服器端驗證：知道房間代號（roomId）就能加入房間。
 * 所以房間代號由 API 以伺服器密鑰做 HMAC 推導，只發給已登入且屬於該租戶的成員；
 * 不同租戶、不同環境（siteId）、不同房間版本都會得到不同代號。
 * 詳細的 SDK 研究與殘餘風險見 openspec/changes/webtalk-multi-tenant/design.md。
 */
import { createHmac } from 'node:crypto';
import type { TenantCtx } from '../../lib/tenant-ctx.js';

/** 房間密鑰最短長度；太短的密鑰可被暴力推算。 */
export const WEBTALK_MIN_SECRET_LENGTH = 32;

export interface WebTalkEnv {
  WEBTALK_ROOM_SECRET?: string;
  WEBTALK_SITE_ID: string;
  WEBTALK_SDK_URL?: string;
  WEBTALK_SDK_INTEGRITY?: string;
  WEBTALK_AI_ENDPOINT?: string;
}

export interface WebTalkServerConfig {
  roomSecret: string;
  siteId: string;
  sdkUrl: string;
  sdkIntegrity: string | null;
  /** 外部 AI 端點；null 代表伺服器沒有提供 AI 摘要 */
  aiEndpoint: string | null;
}

export interface WebTalkSettings {
  enabled: boolean;
  aiEnabled: boolean;
}

export type WebTalkSession =
  | { enabled: false; reason: 'NOT_CONFIGURED' | 'TENANT_DISABLED' }
  | {
      enabled: true;
      roomId: string;
      sdkUrl: string;
      sdkIntegrity: string | null;
      aiEnabled: boolean;
      aiEndpoint: string | null;
    };

/** 預設值：沒有 TenantSettings 列時套用（見 design.md D3） */
const DEFAULTS = { enabled: true, aiEnabled: false, roomVersion: 0 } as const;

/**
 * @description 只接受 https 網址；本機開發可用 http://localhost。
 * @returns 合法時回傳正規化後的網址，否則 null
 */
function safeUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol === 'https:' || (url.protocol === 'http:' && isLocal)) return url.toString();
  return null;
}

/**
 * @description 從環境變數解析 WebTalk 伺服器設定。缺少密鑰、密鑰太短或 SDK 網址不合法時回傳 null（fail-closed），
 *   呼叫端必須把 null 視為「所有租戶都不載入 WebTalk」，不可退回共用房間。
 * @param env 環境變數（`getConfig()` 的結果即可）
 * @returns 伺服器設定；未設定或不合法時為 null
 */
export function resolveWebTalkServerConfig(env: WebTalkEnv): WebTalkServerConfig | null {
  const roomSecret = env.WEBTALK_ROOM_SECRET?.trim() ?? '';
  if (roomSecret.length < WEBTALK_MIN_SECRET_LENGTH) return null;
  const sdkUrl = safeUrl(env.WEBTALK_SDK_URL);
  if (!sdkUrl) return null;
  return {
    roomSecret,
    siteId: env.WEBTALK_SITE_ID,
    sdkUrl,
    sdkIntegrity: env.WEBTALK_SDK_INTEGRITY?.trim() || null,
    aiEndpoint: safeUrl(env.WEBTALK_AI_ENDPOINT),
  };
}

/**
 * @description 推導租戶的 WebTalk 房間代號：HMAC-SHA256(secret, siteId + tenantId + roomVersion)，base64url 編碼。
 *   輸出不含租戶 ID 原文，只含 `[A-Za-z0-9_-]`。
 * @param secret 伺服器密鑰 `WEBTALK_ROOM_SECRET`
 * @param siteId 環境識別 `WEBTALK_SITE_ID`
 * @param tenantId 呼叫者的租戶 ID（必須取自已驗證的成員，不可取自請求輸入）
 * @param roomVersion 租戶的房間版本（重新產生房間代號時加一）
 * @returns 形如 `o333-<43 字元>` 的房間代號
 */
export function deriveWebTalkRoomId(secret: string, siteId: string, tenantId: string, roomVersion: number): string {
  const digest = createHmac('sha256', secret)
    .update(`open333crm:webtalk-room:v1:${siteId}:${tenantId}:${roomVersion}`)
    .digest('base64url');
  return `o333-${digest}`;
}

/**
 * @description 讀取租戶的 WebTalk 設定；沒有設定列時回傳預設值，且不建立新列。
 */
export async function getWebTalkSettings({ tx, tenantId }: TenantCtx): Promise<WebTalkSettings & { roomVersion: number }> {
  const row = await tx.tenantSettings.findUnique({
    where: { tenantId },
    select: { webtalkEnabled: true, webtalkAiEnabled: true, webtalkRoomVersion: true },
  });
  if (!row) return { ...DEFAULTS };
  return { enabled: row.webtalkEnabled, aiEnabled: row.webtalkAiEnabled, roomVersion: row.webtalkRoomVersion };
}

/**
 * @description 更新租戶的 WebTalk 開關；只寫有提供的欄位。
 * @param patch 要更新的開關
 * @returns 更新後的開關
 */
export async function updateWebTalkSettings(
  { tx, tenantId }: TenantCtx,
  patch: Partial<WebTalkSettings>,
): Promise<WebTalkSettings> {
  const data: { webtalkEnabled?: boolean; webtalkAiEnabled?: boolean } = {};
  if (patch.enabled !== undefined) data.webtalkEnabled = patch.enabled;
  if (patch.aiEnabled !== undefined) data.webtalkAiEnabled = patch.aiEnabled;
  const row = await tx.tenantSettings.upsert({
    where: { tenantId },
    create: { tenantId, ...data },
    update: data,
    select: { webtalkEnabled: true, webtalkAiEnabled: true },
  });
  return { enabled: row.webtalkEnabled, aiEnabled: row.webtalkAiEnabled };
}

/**
 * @description 重新產生租戶的房間代號（房間版本加一）。舊代號從此對不到這個租戶的成員。
 */
export async function rotateWebTalkRoom({ tx, tenantId }: TenantCtx): Promise<void> {
  await tx.tenantSettings.upsert({
    where: { tenantId },
    create: { tenantId, webtalkRoomVersion: 1 },
    update: { webtalkRoomVersion: { increment: 1 } },
    select: { webtalkRoomVersion: true },
  });
}

/**
 * @description 組出前端掛載 WebTalk 需要的 session。伺服器未設定或租戶停用時不含房間代號。
 *   AI 端點只在「租戶開啟 AI 摘要」且「伺服器有設定 AI 端點」時回傳。
 * @param ctx 呼叫者租戶的交易
 * @param config `resolveWebTalkServerConfig()` 的結果
 */
export async function buildWebTalkSession(ctx: TenantCtx, config: WebTalkServerConfig | null): Promise<WebTalkSession> {
  if (!config) return { enabled: false, reason: 'NOT_CONFIGURED' };
  const tenantId = ctx.tenantId;
  const settings = await getWebTalkSettings(ctx);
  if (!settings.enabled) return { enabled: false, reason: 'TENANT_DISABLED' };
  const aiEnabled = settings.aiEnabled && config.aiEndpoint !== null;
  return {
    enabled: true,
    roomId: deriveWebTalkRoomId(config.roomSecret, config.siteId, tenantId, settings.roomVersion),
    sdkUrl: config.sdkUrl,
    sdkIntegrity: config.sdkIntegrity,
    aiEnabled,
    aiEndpoint: aiEnabled ? config.aiEndpoint : null,
  };
}
