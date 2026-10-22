/**
 * Webhook Dispatcher — 把事件送給租戶訂閱的網址，以 HMAC 簽章（change outbox-event-delivery，design 決策 11）。
 *
 * - event-webhook 佇列的處理程式：只處理對外事件清單內的事件，為每個訂閱建立一個 webhook-delivery job，
 *   job id 是 <事件 id>__<訂閱 id>。
 * - webhook-delivery 的 processor：每次只送一次 HTTP。失敗時丟錯，由 BullMQ 重試（共 3 次，間隔 1 秒、5 秒）；
 *   API 重新啟動之後重試照常繼續。送出紀錄每個事件、每個訂閱一筆，重試更新同一筆，所以 X-Webhook-Delivery 不變。
 * - 測試送出（POST /webhook-subscriptions/:id/test）用 dispatchWebhook()：在請求內只送一次，不重試。
 */

import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import { createHmac } from 'node:crypto';
import type { EventHandler, SubscribedEvent } from '../../events/subscriber-workers.js';
import { createOrFindExisting, EXTERNAL_EVENT_NAMES, logger, WEBHOOK_DELIVERY_QUEUE } from '@open333crm/core';
import { isBlockedUrl } from '../webhook/downstream-forwarder.js';

const REQUEST_TIMEOUT_MS = 10_000;
/** 第 1 次失敗後等 1 秒、第 2 次失敗後等 5 秒（與改用佇列之前的間隔相同） */
export const WEBHOOK_RETRY_DELAYS_MS = [1_000, 5_000];
const BLOCKED = 'Blocked webhook target';

/**
 * Compute HMAC-SHA256 signature for the payload.
 */
function computeSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

type SendResult = { success: boolean; statusCode?: number; error?: string; blocked?: boolean };

/** 送出一次 HTTP。網址指向內部位址時不送出（SSRF） */
async function sendOnce(input: {
  url: string;
  secret: string;
  eventName: string;
  eventId: string | null;
  deliveryId: string;
  payload: unknown;
}): Promise<SendResult> {
  if (await isBlockedUrl(input.url)) {
    logger.warn('Blocked webhook SSRF target', { deliveryId: input.deliveryId });
    return { success: false, error: BLOCKED, blocked: true };
  }
  const body = JSON.stringify(input.payload);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(input.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${computeSignature(body, input.secret)}`,
        'X-Webhook-Event': input.eventName,
        'X-Webhook-Delivery': input.deliveryId,
        ...(input.eventId ? { 'X-Webhook-Event-Id': input.eventId } : {}),
      },
      body,
      signal: controller.signal,
      redirect: 'error',
    });
    return response.ok
      ? { success: true, statusCode: response.status }
      : { success: false, statusCode: response.status, error: `HTTP ${response.status}` };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  } finally {
    clearTimeout(timeout);
  }
}

function eventIdOf(payload: Record<string, unknown>): string | null {
  return typeof payload.id === 'string' ? payload.id : null;
}

/**
 * 測試送出：建立一筆送出紀錄，送出一次，回傳結果。payload.id 是事件 id。
 */
export async function dispatchWebhook(
  prisma: TenantDb,
  subscriptionId: string,
  url: string,
  secret: string,
  eventName: string,
  payload: Record<string, unknown>,
): Promise<{ success: boolean; statusCode?: number; error?: string; deliveryId: string }> {
  const eventId = eventIdOf(payload);
  const delivery = await prisma.webhookDelivery.create({
    data: {
      subscriptionId,
      eventId,
      eventName,
      payload: payload as Prisma.InputJsonValue,
      attempts: 0,
      success: false,
    },
  });

  const result = await sendOnce({ url, secret, eventName, eventId, deliveryId: delivery.id, payload });
  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: result.blocked
      ? { attempts: 1, success: false, errorMessage: BLOCKED }
      : { attempts: 1, statusCode: result.statusCode ?? null, success: result.success, errorMessage: result.error ?? null },
  });
  return { success: result.success, statusCode: result.statusCode, error: result.error, deliveryId: delivery.id };
}

export interface WebhookDeliveryJob {
  tenantId: string;
  subscriptionId: string;
  eventId: string;
  eventName: string;
  payload: Record<string, unknown>;
}

// Lazy init：避免在 dotenv 載入前讀到 undefined REDIS_URL
let _deliveryQueue: Queue | null = null;
function deliveryQueue(): Queue {
  if (!_deliveryQueue) {
    _deliveryQueue = new Queue(WEBHOOK_DELIVERY_QUEUE, {
      connection: { url: process.env.REDIS_URL! },
      defaultJobOptions: {
        attempts: WEBHOOK_RETRY_DELAYS_MS.length + 1,
        backoff: { type: 'custom' },
        removeOnComplete: { age: 86_400 },
        removeOnFail: { age: 604_800 },
      },
    });
  }
  return _deliveryQueue;
}

/** webhook-delivery Worker 的 backoffStrategy：attemptsMade 是已經失敗的次數 */
export function webhookRetryDelay(attemptsMade: number): number {
  return WEBHOOK_RETRY_DELAYS_MS[Math.min(attemptsMade, WEBHOOK_RETRY_DELAYS_MS.length) - 1] ?? WEBHOOK_RETRY_DELAYS_MS[0];
}

/**
 * 對外 webhook 訂閱者：event-webhook 佇列的每個事件，為訂閱了這個事件的每個網址建立一個 webhook-delivery job。
 */
export function setupWebhookDispatcher(prisma: PrismaClient): EventHandler {
  return async (event: SubscribedEvent) => {
    // 只轉送對外事件清單內的事件（webhook-subscription-egress「只轉送對外事件清單內的事件」）
    if (!EXTERNAL_EVENT_NAMES.has(event.name)) return;

    const subscriptions = await prisma.webhookSubscription.findMany({
      where: {
        tenantId: event.tenantId,
        isActive: true,
        events: { has: event.name },
      },
      select: { id: true },
    });
    if (subscriptions.length === 0) return;

    const payload = {
      id: event.id,
      event: event.name,
      tenantId: event.tenantId,
      timestamp: event.timestamp.toISOString(),
      data: event.payload,
    };
    for (const sub of subscriptions) {
      const job: WebhookDeliveryJob = {
        tenantId: event.tenantId,
        subscriptionId: sub.id,
        eventId: event.id,
        eventName: event.name,
        payload,
      };
      await deliveryQueue().add('webhook:deliver', job, { jobId: `${event.id}__${sub.id}` });
    }
  };
}

/**
 * webhook-delivery 的 processor：送出一次，更新送出紀錄。失敗時丟錯讓 BullMQ 重試；
 * 網址指向內部位址時不重試。
 */
export function processWebhookDelivery(prisma: PrismaClient) {
  return async (job: Job<WebhookDeliveryJob>): Promise<void> => {
    const { tenantId, subscriptionId, eventId, eventName, payload } = job.data;
    const sub = await prisma.webhookSubscription.findFirst({
      where: { id: subscriptionId, tenantId },
      select: { url: true, secret: true, isActive: true },
    });
    // 訂閱在重試期間被刪除或停用：不再送出
    if (!sub || !sub.isActive) return;

    const { row: delivery } = await createOrFindExisting(
      () =>
        prisma.webhookDelivery.createManyAndReturn({
          data: [{ subscriptionId, eventId, eventName, payload: payload as Prisma.InputJsonValue, attempts: 0, success: false }],
          skipDuplicates: true,
        }),
      () => prisma.webhookDelivery.findFirst({ where: { subscriptionId, eventId } }),
    );
    if (delivery.success) return;

    const result = await sendOnce({ url: sub.url, secret: sub.secret, eventName, eventId, deliveryId: delivery.id, payload });
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        attempts: { increment: 1 },
        statusCode: result.statusCode ?? null,
        success: result.success,
        errorMessage: result.error ?? null,
      },
    });
    if (!result.success && !result.blocked) throw new Error(result.error ?? 'webhook delivery failed');
  };
}
