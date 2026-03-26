/**
 * Canvas Webhook trigger — listens for FB/LINE Webhook events and triggers flows (Task 5.2)
 * This module is called from the existing webhook handler when a canvas trigger matches.
 */

import { prisma } from '@open333crm/database';
import { logger } from '@open333crm/core';
import { FlowRunner } from '@open333crm/core';

export interface WebhookTriggerEvent {
  tenantId: string;
  channelType: string;
  channelId: string;
  contactId: string;
  eventType: string; // 'postback' | 'message' | 'follow' | etc.
  payload: Record<string, unknown>;
}

/**
 * Check if any active canvas flow matches this webhook trigger, then launch an execution.
 * Should be called from the existing webhook handlers (LINE/FB) after contact resolution.
 */
export async function handleWebhookFlowTrigger(event: WebhookTriggerEvent): Promise<void> {
  const { tenantId, channelType, contactId, eventType, payload } = event;

  // Find active flows triggered by webhook that match this channel
  const flows = await prisma.interactionFlow.findMany({
    where: {
      tenantId,
      status: 'ACTIVE',
      triggerType: 'webhook',
    },
  });

  if (flows.length === 0) return;

  for (const flow of flows) {
    const triggerConfig = flow.triggerConfig as {
      channelType?: string;
      eventType?: string;
      postbackPattern?: string;
    };

    // Match channelType filter
    if (triggerConfig.channelType && triggerConfig.channelType !== channelType) continue;

    // Match eventType filter (optional)
    if (triggerConfig.eventType && triggerConfig.eventType !== eventType) continue;

    // Match postback data pattern (optional, simple includes check)
    if (triggerConfig.postbackPattern) {
      const postbackData = String(payload.postbackData ?? payload.data ?? '');
      if (!postbackData.includes(triggerConfig.postbackPattern)) continue;
    }

    logger.info(
      `[CanvasWebhook] Triggering flow ${flow.id} for contact ${contactId} (event: ${eventType})`,
    );

    try {
      const execution = await prisma.flowExecution.create({
        data: {
          flowId: flow.id,
          contactId,
          tenantId,
          status: 'RUNNING',
          contextVars: { contact: {}, ext: {}, webhook: payload },
        },
      });

      // Run non-blocking
      FlowRunner.run(execution.id).catch((err) => {
        logger.error(`[CanvasWebhook] FlowRunner error for execution ${execution.id}:`, err);
      });
    } catch (err) {
      logger.error(`[CanvasWebhook] Failed to create FlowExecution for flow ${flow.id}:`, err);
    }
  }
}
