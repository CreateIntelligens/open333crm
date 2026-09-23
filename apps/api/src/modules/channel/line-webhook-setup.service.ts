/**
 * LINE Webhook Auto-Setup Service — automatically configures LINE webhook endpoint.
 */

import type { TenantDb } from '../../lib/tenant-db.js';
import { decryptCredentials } from './channel.service.js';
import { AppError } from '../../shared/utils/response.js';
import { logger } from '@open333crm/core';
import { CHANNEL_TYPE } from '@open333crm/shared';
import { notFound } from '../../shared/messages/resource.js';

export interface LineWebhookSetupResult {
  success: boolean;
  webhookSet: boolean;
  testResult?: { success: boolean; detail?: string };
}

export async function autoSetupLineWebhook(
  prisma: TenantDb,
  channelId: string,
  tenantId: string,
): Promise<LineWebhookSetupResult> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, tenantId, channelType: CHANNEL_TYPE.LINE },
  });

  if (!channel) {
    throw new AppError(notFound('lineChannel'), 'NOT_FOUND', 404);
  }

  if (!channel.webhookUrl) {
    throw new AppError('尚未設定渠道 Webhook 網址，請先於渠道設定填寫 Webhook 基底網址', 'BAD_REQUEST', 400);
  }

  const credentials = decryptCredentials(channel.credentialsEncrypted);
  const accessToken = credentials.channelAccessToken as string;

  if (!accessToken) {
    throw new AppError('缺少 LINE 渠道存取權杖，請至渠道設定填寫', 'BAD_REQUEST', 400);
  }

  // 1. Set webhook endpoint URL
  const setResponse = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ endpoint: channel.webhookUrl }),
  });

  if (!setResponse.ok) {
    const errBody = await setResponse.text();
    // 管理員新增渠道時自動觸發：原文放 details 供排查，message 維持可讀
    throw new AppError(
      'LINE Webhook 自動設定失敗，可改至 LINE 後台手動貼上網址',
      'CHANNEL_SETUP_FAILED',
      400,
      { upstream: errBody, status: setResponse.status },
    );
  }

  // 2. Test webhook endpoint
  let testResult: { success: boolean; detail?: string } | undefined;
  try {
    const testResponse = await fetch('https://api.line.me/v2/bot/channel/webhook/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ endpoint: channel.webhookUrl }),
    });

    if (testResponse.ok) {
      const testData = await testResponse.json() as { success?: boolean; detail?: string };
      testResult = {
        success: testData.success !== false,
        detail: testData.detail || undefined,
      };
    } else {
      testResult = { success: false, detail: `Test failed (${testResponse.status})` };
    }
  } catch (err) {
    testResult = { success: false, detail: 'Test request failed' };
  }

  // 3. Update channel verification timestamp
  await prisma.channel.update({
    where: { id: channelId },
    data: { lastVerifiedAt: new Date() },
  });

  logger.info(`[LineWebhookSetup] Channel ${channelId} webhook set to ${channel.webhookUrl}`);

  return {
    success: true,
    webhookSet: true,
    testResult,
  };
}
