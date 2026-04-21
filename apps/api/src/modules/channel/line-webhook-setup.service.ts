/**
 * LINE Webhook Auto-Setup Service — automatically configures LINE webhook endpoint.
 */

import type { PrismaClient } from '@prisma/client';
import { decryptCredentials } from './channel.service.js';
import { AppError } from '../../shared/utils/response.js';
import { logger } from '@open333crm/core';

export interface LineWebhookSetupResult {
  success: boolean;
  webhookSet: boolean;
  testResult?: { success: boolean; detail?: string };
}

export async function autoSetupLineWebhook(
  prisma: PrismaClient,
  channelId: string,
  tenantId: string,
): Promise<LineWebhookSetupResult> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, tenantId, channelType: 'LINE' },
  });

  if (!channel) {
    throw new AppError('LINE channel not found', 'NOT_FOUND', 404);
  }

  if (!channel.webhookUrl) {
    throw new AppError('Channel webhook URL not set. Please set webhook base URL first.', 'BAD_REQUEST', 400);
  }

  const credentials = decryptCredentials(channel.credentialsEncrypted);
  const accessToken = credentials.channelAccessToken as string;

  if (!accessToken) {
    throw new AppError('Missing LINE channel access token', 'BAD_REQUEST', 400);
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
    throw new AppError(
      `LINE Webhook 設定失敗 (${setResponse.status}): ${errBody}`,
      'CHANNEL_SETUP_FAILED',
      400,
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
