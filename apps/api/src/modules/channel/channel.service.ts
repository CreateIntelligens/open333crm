import type { PrismaClient } from '@prisma/client';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { AppError } from '../../shared/utils/response.js';
import { CHANNEL_TYPE } from '@open333crm/shared';

// --- Credential Encryption ---

const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey(): Buffer {
  const secret = process.env.CREDENTIAL_ENCRYPTION_KEY ?? 'fallback-open333crm-key';
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

export async function listChannels(prisma: PrismaClient, tenantId: string) {
  const channels = await prisma.channel.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      tenantId: true,
      channelType: true,
      displayName: true,
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
  prisma: PrismaClient,
  tenantId: string,
  data: {
    channelType: string;
    displayName: string;
    credentials: Record<string, unknown>;
    settings?: Record<string, unknown>;
    webhookBaseUrl?: string;
  },
) {
  const encrypted = encryptCredentials(data.credentials);

  const channel = await prisma.channel.create({
    data: {
      tenantId,
      channelType: data.channelType as any,
      displayName: data.displayName,
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

export async function getChannel(prisma: PrismaClient, id: string, tenantId: string) {
  const channel = await prisma.channel.findFirst({
    where: { id, tenantId },
    select: {
      id: true,
      tenantId: true,
      channelType: true,
      displayName: true,
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
  const { credentialsEncrypted, ...rest } = channel;
  let maskedCredentials: Record<string, string> = {};
  try {
    const creds = decryptCredentials(credentialsEncrypted);
    maskedCredentials = Object.fromEntries(
      Object.entries(creds).map(([k, v]) => {
        const val = String(v);
        return [k, val.length > 8 ? `${val.slice(0, 4)}...${val.slice(-4)}` : '****'];
      }),
    );
  } catch {
    maskedCredentials = { error: 'Unable to decrypt' };
  }

  return { ...rest, credentials: maskedCredentials };
}

export async function updateChannel(
  prisma: PrismaClient,
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
    updateData.credentialsEncrypted = encryptCredentials(data.credentials);
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

export async function deleteChannel(prisma: PrismaClient, id: string, tenantId: string) {
  const channel = await prisma.channel.findFirst({
    where: { id, tenantId },
  });

  if (!channel) {
    throw new AppError('Channel not found', 'NOT_FOUND', 404);
  }

  await prisma.channel.delete({ where: { id } });

  return { deleted: true };
}

export async function verifyChannel(prisma: PrismaClient, id: string, tenantId: string) {
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
    const response = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${pageAccessToken}`,
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

  throw new AppError(`不支援的渠道類型: ${channel.channelType}`, 'UNSUPPORTED_CHANNEL', 400);
}

export async function updateWebhookBaseUrl(
  prisma: PrismaClient,
  tenantId: string,
  baseUrl: string,
) {
  // Remove trailing slash
  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');

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
