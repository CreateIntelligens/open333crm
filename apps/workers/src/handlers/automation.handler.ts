import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type IORedis from 'ioredis';
import { logger } from '@open333crm/core';
import { publishSocketEvent } from '../lib/socket-bridge.js';

interface AutomationJobData {
  tenantId: string;
  trigger: string;
  context: Record<string, unknown>;
}

type RuleAction = { type: string; params: Record<string, unknown> };

export async function handleAutomationJob(
  job: Job,
  prisma: PrismaClient,
  redisPublisher: IORedis,
): Promise<void> {
  const { tenantId, trigger, context } = job.data as AutomationJobData;

  const rules = await prisma.automationRule.findMany({
    where: { tenantId, eventType: trigger, isActive: true },
  });

  if (rules.length === 0) return;

  logger.info(`[automation] ${rules.length} rule(s) match trigger "${trigger}" for tenant ${tenantId}`);

  for (const rule of rules) {
    try {
      const actions = (rule.actions as RuleAction[]) ?? [];

      for (const action of actions) {
        if (action.type === 'assign_agent' && typeof context['caseId'] === 'string') {
          await prisma.case.update({
            where: { id: context['caseId'] },
            data: { assigneeId: action.params['agentId'] as string },
          });
        } else if (action.type === 'update_status' && typeof context['caseId'] === 'string') {
          await prisma.case.update({
            where: { id: context['caseId'] },
            data: { status: action.params['status'] as any },
          });
        }
      }

      await publishSocketEvent(
        redisPublisher,
        `tenant:${tenantId}`,
        'automation.executed',
        { ruleId: rule.id, trigger, context },
      );

      logger.info(`[automation] Rule ${rule.id} executed for trigger "${trigger}"`);
    } catch (err) {
      logger.error(`[automation] Rule ${rule.id} failed`, { err });
    }
  }
}
