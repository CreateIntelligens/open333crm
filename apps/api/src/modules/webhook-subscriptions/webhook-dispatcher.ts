/**
 * Webhook Dispatcher — subscribes to eventBus wildcard and dispatches
 * matching events to registered webhook subscriptions with HMAC signing.
 */

import type { PrismaClient } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { eventBus, type AppEvent } from '../../events/event-bus.js';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 15000]; // 1s, 5s, 15s

/**
 * Compute HMAC-SHA256 signature for the payload.
 */
function computeSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Dispatch a single webhook delivery with retries.
 */
export async function dispatchWebhook(
  prisma: PrismaClient,
  subscriptionId: string,
  url: string,
  secret: string,
  eventName: string,
  payload: Record<string, unknown>,
): Promise<{ success: boolean; statusCode?: number; error?: string; deliveryId: string }> {
  const body = JSON.stringify(payload);
  const signature = computeSignature(body, secret);

  // Create delivery record
  const delivery = await prisma.webhookDelivery.create({
    data: {
      subscriptionId,
      eventName,
      payload: payload as any,
      attempts: 0,
      success: false,
    },
  });

  let lastStatusCode: number | undefined;
  let lastError: string | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        await sleep(RETRY_DELAYS[attempt - 1] || 15000);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': `sha256=${signature}`,
          'X-Webhook-Event': eventName,
          'X-Webhook-Delivery': delivery.id,
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      lastStatusCode = response.status;

      // Update delivery record
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts: attempt + 1,
          statusCode: response.status,
          success: response.ok,
          errorMessage: response.ok ? null : `HTTP ${response.status}`,
        },
      });

      if (response.ok) {
        return { success: true, statusCode: response.status, deliveryId: delivery.id };
      }

      lastError = `HTTP ${response.status}`;
    } catch (err) {
      lastError = (err as Error).message;
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts: attempt + 1,
          statusCode: null,
          success: false,
          errorMessage: lastError,
        },
      });
    }
  }

  return {
    success: false,
    statusCode: lastStatusCode,
    error: lastError,
    deliveryId: delivery.id,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Setup the webhook dispatcher — subscribes to eventBus wildcard
 * and dispatches matching events to registered subscriptions.
 */
export function setupWebhookDispatcher(prisma: PrismaClient) {
  eventBus.subscribe('*', async (event: AppEvent) => {
    try {
      // Find all active subscriptions for this tenant that subscribe to this event
      const subscriptions = await prisma.webhookSubscription.findMany({
        where: {
          tenantId: event.tenantId,
          isActive: true,
          events: { has: event.name },
        },
      });

      if (subscriptions.length === 0) return;

      const payload = {
        event: event.name,
        tenantId: event.tenantId,
        timestamp: event.timestamp.toISOString(),
        data: event.payload,
      };

      // Dispatch in parallel (non-blocking)
      for (const sub of subscriptions) {
        dispatchWebhook(prisma, sub.id, sub.url, sub.secret, event.name, payload).catch(
          (err) => console.error(`[WebhookDispatcher] Failed for subscription ${sub.id}:`, err),
        );
      }
    } catch (err) {
      console.error('[WebhookDispatcher] Error processing event:', err);
    }
  });

  console.log('[WebhookDispatcher] Started — listening on eventBus wildcard');
}
