/**
 * BYOK — 租戶自備 Gemini API key。
 * 加密複用 channel 憑證的 AES-256-GCM（同 CREDENTIAL_ENCRYPTION_KEY），
 * key 密文存 TenantSettings.geminiApiKeyEnc。
 *
 * 三層 fallback 取 key：租戶自填 → 平台代設（暫同 env）→ 全域 env GEMINI_API_KEY。
 */
import type { PrismaClient } from '@prisma/client';
import { encryptCredentials, decryptCredentials } from '../channel/channel.service.js';
import { getConfig } from '../../config/env.js';

const FIELD = 'geminiApiKey';

export function encryptApiKey(plain: string): string {
  return encryptCredentials({ [FIELD]: plain });
}

export function decryptApiKey(enc: string): string {
  const obj = decryptCredentials(enc);
  return String(obj[FIELD] ?? '');
}

/**
 * 取租戶實際要用的 Gemini key 與來源。
 * 來源：byok（租戶自填）| platform（env fallback）。
 */
export async function resolveGeminiKey(
  prisma: PrismaClient,
  tenantId: string,
): Promise<{ key: string | undefined; source: 'byok' | 'platform' }> {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { geminiApiKeyEnc: true },
  });
  if (settings?.geminiApiKeyEnc) {
    try {
      const key = decryptApiKey(settings.geminiApiKeyEnc);
      if (key) return { key, source: 'byok' };
    } catch {
      /* 解密失敗（如換過加密 key）→ 退回平台 key */
    }
  }
  // 平台代設 / 全域 env（目前兩者同源；日後平台可設 per-tenant key 再擴充）
  return { key: getConfig().GEMINI_API_KEY, source: 'platform' };
}

/** 儲存/清除租戶 BYOK key（傳 null 清除）。 */
export async function setTenantGeminiKey(
  prisma: PrismaClient,
  tenantId: string,
  plainKey: string | null,
): Promise<void> {
  // upsert：TenantSettings 為延遲建立，新開通、尚未動過設定的租戶可能還沒有此列，
  // 用 update 會拋 P2025（回 404）導致 BYOK key 存不進去 → 改 upsert。
  const enc = plainKey ? encryptApiKey(plainKey) : null;
  await prisma.tenantSettings.upsert({
    where: { tenantId },
    create: { tenantId, geminiApiKeyEnc: enc },
    update: { geminiApiKeyEnc: enc },
  });
}

/** 回傳遮罩後的 key 狀態（不外洩明文）。 */
export async function getTenantGeminiKeyStatus(
  prisma: PrismaClient,
  tenantId: string,
): Promise<{ configured: boolean; masked: string | null }> {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { geminiApiKeyEnc: true },
  });
  if (!settings?.geminiApiKeyEnc) return { configured: false, masked: null };
  try {
    const key = decryptApiKey(settings.geminiApiKeyEnc);
    const masked = key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : '已設定';
    return { configured: true, masked };
  } catch {
    return { configured: true, masked: '（無法解密）' };
  }
}
