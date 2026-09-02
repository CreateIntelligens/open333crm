import type { TenantDb } from '../../lib/tenant-db.js';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { AppError } from '../../shared/utils/response.js';
import { CHANNEL_TYPE } from '@open333crm/shared';
import { resolveEffectiveLimit } from '../platform/plan-limits.service.js';

// --- Credential Encryption ---

const ALGORITHM = 'aes-256-gcm';

function generatePublicKey(): string {
  return `ch_${randomUUID().replace(/-/g, '')}`;
}

function getEncryptionKey(): Buffer {
  const secret = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must be set');
  }
  return scryptSync(secret, 'open333crm-credentials', 32);
}

export function encryptCredentials(plain: Record<string, unknown>): string {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(JSON.stringify(plain), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptCredentials(encrypted: string): Record<string, unknown> {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, data] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

// --- Channel CRUD ---

export async function listChannels(prisma: TenantDb, tenantId: string) {
  const channels = await prisma.channel.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      tenantId: true,
      channelType: true,
      displayName: true,
      publicKey: true,
      isActive: true,
      webhookUrl: true,
      lastVerifiedAt: true,
      settings: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return channels;
}

export async function createChannel(
  prisma: TenantDb,
  tenantId: string,
  data: {
    channelType: string;
    displayName: string;
    credentials: Record<string, unknown>;
    settings?: Record<string, unknown>;
    webhookBaseUrl?: string;
  },
) {
  // 方案層渠道管控（一次查 tenant+plan，供白名單與數量上限共用）。
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      limitOverrides: true,
      plan: { select: { limits: true, allowedChannelTypes: true } },
    },
  });
  // fail-loud：查不到租戶就報錯，而非靜默跳過所有方案限制（fail-open）
  if (!tenant) throw new AppError('租戶不存在', 'NOT_FOUND', 404);

  // 渠道 provider 白名單硬擋：白名單非空且此類型不在內 → 擋。空陣列 = 不限制。只擋新建。
  const allowed = (tenant.plan?.allowedChannelTypes ?? []) as string[];
  if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(data.channelType)) {
    throw new AppError('此方案不允許建立該渠道類型，請升級方案或改用其他渠道', 'CHANNEL_TYPE_NOT_ALLOWED', 403, {
      channelType: data.channelType,
      allowed,
    });
  }

  // 渠道數上限硬擋（建立時 count 檢查；無上限 = null 時跳過）。只算 isActive，比照 maxAgents。
  const maxChannels = resolveEffectiveLimit(tenant, 'maxChannels');
  if (maxChannels !== null) {
    const activeCount = await prisma.channel.count({ where: { tenantId, isActive: true } });
    if (activeCount >= maxChannels) {
      throw new AppError('已達方案渠道數上限，請升級方案', 'PLAN_LIMIT_EXCEEDED', 403, {
        limitKey: 'maxChannels',
        current: activeCount,
        max: maxChannels,
      });
    }
  }

  const encrypted = encryptCredentials(data.credentials);

  const channel = await prisma.channel.create({
    data: {
      tenantId,
      channelType: data.channelType as any,
      displayName: data.displayName,
      publicKey: generatePublicKey(),
      isActive: true,
      credentialsEncrypted: encrypted,
      settings: (data.settings ?? {}) as any,
    },
  });

  // Generate and store webhook URL
  const apiBaseUrl = data.webhookBaseUrl || process.env.API_BASE_URL || `http://localhost:${process.env.API_PORT || 3001}`;
  const channelTypePath = data.channelType.toLowerCase();
  const webhookUrl = `${apiBaseUrl}/api/v1/webhooks/${channelTypePath}/${channel.id}`;

  const updated = await prisma.channel.update({
    where: { id: channel.id },
    data: { webhookUrl },
    select: {
      id: true,
      tenantId: true,
      channelType: true,
      displayName: true,
      publicKey: true,
      isActive: true,
      webhookUrl: true,
      lastVerifiedAt: true,
      settings: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return updated;
}

export async function getChannel(prisma: TenantDb, id: string, tenantId: string) {
  const channel = await prisma.channel.findFirst({
    where: { id, tenantId },
    select: {
      id: true,
      tenantId: true,
      channelType: true,
      displayName: true,
      publicKey: true,
      isActive: true,
      webhookUrl: true,
      lastVerifiedAt: true,
      settings: true,
      credentialsEncrypted: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!channel) {
    throw new AppError('Channel not found', 'NOT_FOUND', 404);
  }

  // Return with masked credentials
  // 非機密欄位完整回傳：verifyToken 要貼到 Meta 後台做 webhook 驗證、ID 類本來就非機密
  const PLAIN_CREDENTIAL_KEYS = new Set(['verifyToken', 'appId', 'pageId']);
  const { credentialsEncrypted, ...rest } = channel;
  let maskedCredentials: Record<string, string> = {};
  try {
    const creds = decryptCredentials(credentialsEncrypted);
    maskedCredentials = Object.fromEntries(
      Object.entries(creds).map(([k, v]) => {
        const val = String(v);
        if (PLAIN_CREDENTIAL_KEYS.has(k)) return [k, val];
        return [k, val.length > 8 ? `${val.slice(0, 4)}...${val.slice(-4)}` : '****'];
      }),
    );
  } catch {
    maskedCredentials = { error: 'Unable to decrypt' };
  }

  return { ...rest, credentials: maskedCredentials };
}

export async function updateChannel(
  prisma: TenantDb,
  id: string,
  tenantId: string,
  data: {
    displayName?: string;
    isActive?: boolean;
    credentials?: Record<string, unknown>;
    settings?: Record<string, unknown>;
  },
) {
  const channel = await prisma.channel.findFirst({
    where: { id, tenantId },
  });

  if (!channel) {
    throw new AppError('Channel not found', 'NOT_FOUND', 404);
  }

  const updateData: Record<string, unknown> = {};

  if (data.displayName !== undefined) {
    updateData.displayName = data.displayName;
  }
  if (data.isActive !== undefined) {
    updateData.isActive = data.isActive;
  }
  if (data.credentials) {
    // 部分更新：先合併舊憑證，再以本次明確提供（非 undefined）的欄位覆蓋，
    // 避免編輯表單沒填的 appId/pageId/verifyToken 等既有欄位被洗掉
    let nextCredentials = data.credentials;
    try {
      const oldCreds = decryptCredentials(channel.credentialsEncrypted);
      const provided = Object.fromEntries(
        Object.entries(data.credentials).filter(([, v]) => v !== undefined),
      );
      nextCredentials = { ...oldCreds, ...provided };
    } catch {
      /* 舊憑證解不開（跨環境金鑰不符）就直接用新憑證 */
    }
    updateData.credentialsEncrypted = encryptCredentials(nextCredentials);
  }
  if (data.settings !== undefined) {
    updateData.settings = data.settings;
  }

  const updated = await prisma.channel.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      tenantId: true,
      channelType: true,
      displayName: true,
      publicKey: true,
      isActive: true,
      webhookUrl: true,
      lastVerifiedAt: true,
      settings: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return updated;
}

export async function deleteChannel(prisma: TenantDb, id: string, tenantId: string) {
  const channel = await prisma.channel.findFirst({
    where: { id, tenantId },
  });

  if (!channel) {
    throw new AppError('Channel not found', 'NOT_FOUND', 404);
  }

  await prisma.channel.delete({ where: { id } });

  return { deleted: true };
}

export async function ensureChannelPublicKey(
  prisma: TenantDb,
  id: string,
  tenantId: string,
): Promise<{ publicKey: string }> {
  const channel = await prisma.channel.findFirst({
    where: { id, tenantId },
    select: { id: true, publicKey: true },
  });

  if (!channel) {
    throw new AppError('Channel not found', 'NOT_FOUND', 404);
  }

  if (channel.publicKey) {
    return { publicKey: channel.publicKey };
  }

  const updated = await prisma.channel.update({
    where: { id },
    data: { publicKey: generatePublicKey() },
    select: { publicKey: true },
  });

  if (!updated.publicKey) {
    throw new AppError('Unable to generate channel public key', 'INTERNAL_ERROR', 500);
  }

  return { publicKey: updated.publicKey };
}

export async function verifyChannel(prisma: TenantDb, id: string, tenantId: string) {
  const channel = await prisma.channel.findFirst({
    where: { id, tenantId },
  });

  if (!channel) {
    throw new AppError('Channel not found', 'NOT_FOUND', 404);
  }

  const credentials = decryptCredentials(channel.credentialsEncrypted);

  if (channel.channelType === CHANNEL_TYPE.LINE) {
    const token = credentials.channelAccessToken as string;

    const response = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const errBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      throw new AppError(
        (errBody.message as string) ?? `LINE API 驗證失敗 (${response.status})`,
        'CHANNEL_VERIFY_FAILED',
        400,
      );
    }

    const botInfo = (await response.json()) as Record<string, unknown>;

    await prisma.channel.update({
      where: { id },
      data: { lastVerifiedAt: new Date() },
    });

    return { verified: true, botInfo };
  }

  if (channel.channelType === CHANNEL_TYPE.FB) {
    const pageAccessToken = credentials.pageAccessToken as string;

    // Verify the page access token by calling the Graph API
    // token 走 Authorization header，避免出現在 URL 被代理/日誌記錄
    const response = await fetch(
      'https://graph.facebook.com/v21.0/me?fields=id,name',
      { headers: { Authorization: `Bearer ${pageAccessToken}` } },
    );

    if (!response.ok) {
      const errBody = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      throw new AppError(
        errBody.error?.message ?? `Facebook API 驗證失敗 (${response.status})`,
        'CHANNEL_VERIFY_FAILED',
        400,
      );
    }

    const pageInfo = (await response.json()) as Record<string, unknown>;

    await prisma.channel.update({
      where: { id },
      data: { lastVerifiedAt: new Date() },
    });

    return { verified: true, pageInfo };
  }

  if (channel.channelType === CHANNEL_TYPE.THREADS) {
    const pageAccessToken = credentials.pageAccessToken as string;

    // 走 IG Login 路線，用 Instagram Graph API 驗證 token 有效
    // token 走 Authorization header，避免出現在 URL 被代理/日誌記錄，也免去編碼問題
    const response = await fetch(
      'https://graph.instagram.com/v21.0/me?fields=id',
      { headers: { Authorization: `Bearer ${pageAccessToken}` } },
    );

    if (!response.ok) {
      const errBody = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      throw new AppError(
        errBody.error?.message ?? `Instagram API 驗證失敗 (${response.status})`,
        'CHANNEL_VERIFY_FAILED',
        400,
      );
    }

    const igInfo = (await response.json()) as Record<string, unknown>;

    await prisma.channel.update({
      where: { id },
      data: { lastVerifiedAt: new Date() },
    });

    return { verified: true, pageInfo: igInfo };
  }

  throw new AppError(`不支援的渠道類型: ${channel.channelType}`, 'UNSUPPORTED_CHANNEL', 400);
}

export async function updateWebhookBaseUrl(
  prisma: TenantDb,
  tenantId: string,
  baseUrl: string,
) {
  // Remove surrounding whitespace and trailing slash（結尾空格會產生無效的 webhook URL）
  const cleanBaseUrl = baseUrl.trim().replace(/\/+$/, '');

  const channels = await prisma.channel.findMany({
    where: { tenantId },
  });

  const updated = [];
  for (const ch of channels) {
    const channelTypePath = ch.channelType.toLowerCase();
    const webhookUrl = `${cleanBaseUrl}/api/v1/webhooks/${channelTypePath}/${ch.id}`;

    const result = await prisma.channel.update({
      where: { id: ch.id },
      data: { webhookUrl },
      select: {
        id: true,
        channelType: true,
        displayName: true,
        webhookUrl: true,
      },
    });
    updated.push(result);
  }

  return updated;
}
