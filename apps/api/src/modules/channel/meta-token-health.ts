/**
 * FB／IG 渠道權杖健康檢查與失效通知（change fix-meta-webhook-page-routing，SaaS 開放前的缺口）。
 *
 * 粉專權杖會因為管理員改密碼、被移除管理員身分、在 Facebook 設定移除應用程式等原因失效。
 * 失效後渠道收不到也回不了訊息，但後台看起來一切正常——客戶會以為「系統壞了」。
 *
 * 排程每 6 小時檢查所有啟用中的 FB／IG 渠道：
 *   - 結果寫進 settings.tokenHealth，渠道卡片顯示
 *   - 從有效變成失效時，通知該租戶所有管理員（站內通知＋email）；持續失效每 3 天再提醒一次
 *   - 網路錯誤、Meta 服務異常等「無法判斷」的情況不改狀態、不通知（避免誤報）
 */
import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { logger } from '@open333crm/core';
import { CHANNEL_TYPE } from '@open333crm/shared';
import { getConfig } from '../../config/env.js';
import { withLeaderLock } from '../../lib/scheduler-lock.js';
import { createAndDispatch } from '../notification/notification.service.js';
import { sendEmail } from '../email/email.service.js';
import { decryptCredentials } from './channel.service.js';

const HOUR_MS = 3600_000;
const CHECK_INTERVAL_MS = 6 * HOUR_MS;
const REMIND_INTERVAL_MS = 72 * HOUR_MS;
/** Meta 的限流錯誤碼：type 同樣是 OAuthException，但與權杖是否有效無關 */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80001, 80002, 80006]);

/** 190 權杖失效／過期／被撤銷、102 工作階段失效、10 與 200–299 權限被撤銷 */
function isTokenInvalidCode(code: number): boolean {
  return code === 190 || code === 102 || code === 10 || (code >= 200 && code <= 299);
}

/**
 * 只在權杖仍是檢查時那一組的情況下寫入（資料庫端比對密文，原子操作）。
 * 檢查期間管理員重新連結或更新權杖時回 false，避免用舊權杖的結果蓋掉新狀態、發出錯誤通知。
 */
async function writeTokenHealthIfUnchanged(
  prisma: PrismaClient,
  ch: { id: string; tenantId: string; credentialsEncrypted: string },
  health: TokenHealth,
): Promise<boolean> {
  const count = await prisma.$executeRaw`
    UPDATE channels
    SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('tokenHealth', ${JSON.stringify(health)}::jsonb),
        "updatedAt" = now()
    WHERE id = ${ch.id}::uuid AND "tenantId" = ${ch.tenantId}::uuid
      AND "credentialsEncrypted" = ${ch.credentialsEncrypted} AND "isActive" = true`;
  return count > 0;
}

export type TokenHealthStatus = 'valid' | 'invalid';

export interface TokenHealth {
  status: TokenHealthStatus;
  checkedAt: string;
  /** 失效原因（Meta 回傳的錯誤訊息） */
  reason?: string;
  /** 最近一次通知管理員的時間 */
  notifiedAt?: string;
}

export type ProbeResult = { status: TokenHealthStatus; reason?: string } | { status: 'unknown'; reason: string };

/**
 * 用渠道權杖呼叫一次 /me 判斷是否仍有效。
 * 只有明確的失效訊號（401、190 權杖失效、權限被撤銷）才算失效；網路錯誤、5xx、429、限流與其他錯誤回 unknown。
 */
export async function probeChannelToken(channelType: string, credentials: Record<string, unknown>): Promise<ProbeResult> {
  const token = credentials.pageAccessToken as string | undefined;
  if (!token) return { status: 'invalid', reason: '渠道沒有存取權杖' };
  const url =
    channelType === CHANNEL_TYPE.THREADS
      ? 'https://graph.instagram.com/v21.0/me?fields=user_id'
      : 'https://graph.facebook.com/v21.0/me?fields=id';
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    return { status: 'unknown', reason: err instanceof Error ? err.message : String(err) };
  }
  if (res.ok) return { status: 'valid' };
  const body = (await res.json().catch(() => ({}))) as {
    error?: { type?: string; code?: number; message?: string; is_transient?: boolean };
  };
  const e = body.error;
  // 401 本身就是明確的失效訊號，沒有錯誤內容也算
  if (res.status === 401) return { status: 'invalid', reason: e?.message ?? '權杖已失效' };
  if (res.status >= 500 || res.status === 429 || !e) return { status: 'unknown', reason: e?.message ?? `HTTP ${res.status}` };
  if (e.is_transient || (e.code !== undefined && RATE_LIMIT_CODES.has(e.code))) {
    return { status: 'unknown', reason: e.message ?? `HTTP ${res.status}` };
  }
  // 只認明確的失效訊號；其他錯誤（包括沒列出的 OAuthException）一律當無法判斷，寧可漏報也不誤發通知
  if (e.code !== undefined && isTokenInvalidCode(e.code)) {
    return { status: 'invalid', reason: e.message ?? '權杖已失效' };
  }
  return { status: 'unknown', reason: e.message ?? `HTTP ${res.status}` };
}

/** 依前一次狀態與這次檢查結果，決定要寫入的狀態與是否通知管理員 */
export function nextTokenHealth(
  prev: TokenHealth | undefined,
  probe: ProbeResult,
  now: Date,
): { health: TokenHealth | undefined; notify: boolean } {
  if (probe.status === 'unknown') return { health: prev, notify: false };
  if (probe.status === 'valid') {
    return { health: { status: 'valid', checkedAt: now.toISOString() }, notify: false };
  }
  const lastNotified = prev?.status === 'invalid' && prev.notifiedAt ? new Date(prev.notifiedAt).getTime() : 0;
  const notify = prev?.status !== 'invalid' || now.getTime() - lastNotified >= REMIND_INTERVAL_MS;
  return {
    health: {
      status: 'invalid',
      checkedAt: now.toISOString(),
      reason: probe.reason,
      notifiedAt: notify ? now.toISOString() : prev?.notifiedAt,
    },
    notify,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** 失效通知信（不放 emoji，樣式從簡） */
function tokenInvalidEmailHtml(vars: { channelName: string; channelLabel: string; platformMode: boolean; url: string }): string {
  const action = vars.platformMode
    ? '請到「設定 → 渠道管理」按「用 Facebook 連結粉專」重新連結這個粉專，系統會更新權杖並保留原本的對話紀錄。'
    : '請到「設定 → 渠道管理」編輯這個渠道，貼上新的存取權杖後按「測試連線」。';
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'PingFang TC','Microsoft JhengHei',sans-serif;color:#1a2230;max-width:560px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 16px;color:#d1443e;font-size:20px">渠道權杖已失效</h2>
  <p style="line-height:1.7">${escapeHtml(vars.channelLabel)}渠道「${escapeHtml(vars.channelName)}」的存取權杖已失效，目前<strong>收不到新訊息，也無法回覆顧客</strong>。</p>
  <p style="line-height:1.7">常見原因：粉專管理員變更了 Facebook 密碼、被移除管理員身分，或在 Facebook 設定中移除了我們的應用程式。</p>
  <p style="line-height:1.7">${action}</p>
  <p style="margin:24px 0"><a href="${escapeHtml(vars.url)}" style="background:#0d9488;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">前往渠道管理</a></p>
  <p style="color:#97a0ae;font-size:12px">若已處理完成，可以忽略這封信。</p>
</div>`;
}

async function notifyAdmins(
  prisma: PrismaClient,
  io: SocketIOServer,
  channel: { tenantId: string; displayName: string; channelType: string },
  platformMode: boolean,
): Promise<void> {
  const admins = await prisma.agent.findMany({
    where: { tenantId: channel.tenantId, role: 'ADMIN', isActive: true },
    select: { id: true, email: true },
  });
  const channelLabel = channel.channelType === CHANNEL_TYPE.THREADS ? 'Instagram ' : 'Facebook ';
  const clickUrl = '/dashboard/settings/channels';
  const title = `${channelLabel}渠道「${channel.displayName}」權杖已失效`;
  const body = platformMode
    ? '目前收不到也無法回覆訊息。請到渠道管理按「用 Facebook 連結粉專」重新連結。'
    : '目前收不到也無法回覆訊息。請到渠道管理更新存取權杖。';
  const url = `${getConfig().WEB_BASE_URL}${clickUrl}`;
  for (const admin of admins) {
    await createAndDispatch(prisma, io, { tenantId: channel.tenantId, agentId: admin.id, type: 'channel_token_invalid', title, body, clickUrl }).catch(
      (err: unknown) => logger.error('[MetaTokenHealth] 站內通知失敗', { agentId: admin.id, error: err instanceof Error ? err.message : String(err) }),
    );
    await sendEmail({
      to: admin.email,
      subject: `【open333】${title}`,
      html: tokenInvalidEmailHtml({ channelName: channel.displayName, channelLabel, platformMode, url }),
      metadata: { type: 'channel_token_invalid' },
    }).catch((err: unknown) =>
      logger.error('[MetaTokenHealth] 通知信寄送失敗', { to: admin.email, error: err instanceof Error ? err.message : String(err) }),
    );
  }
}

/** 檢查所有啟用中的 FB／IG 渠道（跨租戶，需 BYPASSRLS 連線）。逐渠道 try/catch，單一失敗不影響其他 */
export async function runMetaTokenHealthCheck(prisma: PrismaClient, io: SocketIOServer, now = new Date()): Promise<void> {
  const channels = await prisma.channel.findMany({
    where: { isActive: true, channelType: { in: [CHANNEL_TYPE.FB, CHANNEL_TYPE.THREADS] as never }, tenant: { isActive: true } },
    select: { id: true, tenantId: true, channelType: true, displayName: true, credentialsEncrypted: true, settings: true },
  });
  for (const ch of channels) {
    try {
      let credentials: Record<string, unknown> = {};
      let probe: ProbeResult;
      try {
        credentials = decryptCredentials(ch.credentialsEncrypted);
        probe = await probeChannelToken(ch.channelType, credentials);
      } catch {
        // 加密金鑰不同（例如從別的環境同步過來的資料）：權杖讀不出來，同樣收不到訊息
        probe = { status: 'invalid', reason: '渠道憑證無法解密，請重新填寫存取權杖' };
      }
      const prev = ((ch.settings ?? {}) as Record<string, unknown>).tokenHealth as TokenHealth | undefined;
      const { health, notify } = nextTokenHealth(prev, probe, now);
      if (!health || health === prev) continue; // 無法判斷：狀態不變
      // 權杖在檢查期間被換掉（重新連結、手動更新）就不寫入、不通知
      if (!(await writeTokenHealthIfUnchanged(prisma, ch, health))) continue;
      if (notify) {
        logger.warn('[MetaTokenHealth] 渠道權杖失效，通知管理員', { channelId: ch.id, tenantId: ch.tenantId, reason: probe.reason });
        await notifyAdmins(prisma, io, ch, credentials.connectMode === 'platform');
      }
    } catch (err) {
      logger.error('[MetaTokenHealth] 檢查渠道失敗', { channelId: ch.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

export function setupMetaTokenHealthScheduler(prisma: PrismaClient, io: SocketIOServer): void {
  const tick = () =>
    withLeaderLock('meta-token-health', Math.floor(CHECK_INTERVAL_MS * 0.9), () => runMetaTokenHealthCheck(prisma, io)).catch((err) =>
      logger.error('[MetaTokenHealth] 排程執行失敗', err),
    );
  // 啟動 2 分鐘後先跑一次（避開部署當下的負載），之後每 6 小時
  setTimeout(tick, 2 * 60_000);
  setInterval(tick, CHECK_INTERVAL_MS);
  logger.info('[MetaTokenHealth] Started — FB/IG token health check every 6h');
}
