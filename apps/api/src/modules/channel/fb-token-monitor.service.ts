/**
 * Facebook Token Monitor Service — checks FB page access token health.
 */

import type { PrismaClient } from '@prisma/client';
import { decryptCredentials } from './channel.service.js';
import { AppError } from '../../shared/utils/response.js';
import { logger } from '@open333crm/core';

export interface TokenStatus {
  valid: boolean;
  expiresAt?: string;
  daysRemaining?: number;
  warning?: string;
}

export async function checkFbTokenStatus(
  prisma: PrismaClient,
  channelId: string,
  tenantId: string,
): Promise<TokenStatus> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, tenantId, channelType: 'FB' },
  });

  if (!channel) {
    throw new AppError('Facebook channel not found', 'NOT_FOUND', 404);
  }

  const credentials = decryptCredentials(channel.credentialsEncrypted);
  const pageAccessToken = credentials.pageAccessToken as string;
  const appId = credentials.appId as string | undefined;
  const appSecret = credentials.appSecret as string | undefined;

  if (!pageAccessToken) {
    throw new AppError('Missing Facebook page access token', 'BAD_REQUEST', 400);
  }

  // Use debug_token endpoint if we have app credentials
  if (appId && appSecret) {
    try {
      const appAccessToken = `${appId}|${appSecret}`;
      const response = await fetch(
        `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(pageAccessToken)}&access_token=${encodeURIComponent(appAccessToken)}`,
      );

      if (response.ok) {
        const data = await response.json() as {
          data?: {
            is_valid?: boolean;
            expires_at?: number;
            error?: { message?: string };
          };
        };

        const tokenData = data.data;
        if (!tokenData) {
          return { valid: false, warning: '無法取得 Token 資訊' };
        }

        const isValid = tokenData.is_valid !== false;
        let expiresAt: string | undefined;
        let daysRemaining: number | undefined;
        let warning: string | undefined;

        if (tokenData.expires_at && tokenData.expires_at > 0) {
          const expiresDate = new Date(tokenData.expires_at * 1000);
          expiresAt = expiresDate.toISOString();
          daysRemaining = Math.ceil((expiresDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

          if (daysRemaining <= 0) {
            warning = 'Token 已過期，請重新產生';
          } else if (daysRemaining <= 7) {
            warning = `Token 將在 ${daysRemaining} 天內過期，請盡快更新`;
          } else if (daysRemaining <= 30) {
            warning = `Token 將在 ${daysRemaining} 天後過期`;
          }
        }

        // Store token expiry in channel settings
        const currentSettings = (channel.settings || {}) as Record<string, unknown>;
        await prisma.channel.update({
          where: { id: channelId },
          data: {
            settings: { ...currentSettings, tokenExpiresAt: expiresAt } as any,
            lastVerifiedAt: new Date(),
          },
        });

        if (!isValid) {
          return { valid: false, expiresAt, daysRemaining, warning: tokenData.error?.message || 'Token 無效' };
        }

        return { valid: true, expiresAt, daysRemaining, warning };
      }
    } catch (err) {
      logger.error('[FbTokenMonitor] debug_token request failed:', err);
    }
  }

  // Fallback: just check if token works by calling /me
  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(pageAccessToken)}`,
    );

    if (response.ok) {
      await prisma.channel.update({
        where: { id: channelId },
        data: { lastVerifiedAt: new Date() },
      });
      return { valid: true };
    }

    const errData = await response.json() as { error?: { message?: string } };
    return { valid: false, warning: errData.error?.message || 'Token 驗證失敗' };
  } catch {
    return { valid: false, warning: '無法連接 Facebook API' };
  }
}
