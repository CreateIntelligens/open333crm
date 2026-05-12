import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type IORedis from 'ioredis';
import { logger } from '@open333crm/core';
import { evaluateRules } from '@open333crm/automation';
import { publishSocketEvent } from '../lib/socket-bridge.js';
import { executeWorkerAutomationActions } from '../lib/automation-actions.js';
import { buildAutomationFacts } from '../lib/automation-facts.js';

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

  const ruleInputs = rules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    priority: rule.priority,
    stopOnMatch: rule.stopOnMatch,
    conditions: rule.conditions as any,
    actions: (rule.actions as RuleAction[]) ?? [],
  }));

  const facts = await buildAutomationFacts(prisma, { tenantId, ...context });
  const matched = await evaluateRules(ruleInputs, facts);

  logger.info(
    `[automation] ${matched.length}/${rules.length} rule(s) matched trigger "${trigger}" for tenant ${tenantId}`,
  );

  for (const match of matched) {
    const caseId = facts['caseId'];
    if (typeof caseId === 'string') {
      await executeWorkerAutomationActions(prisma, redisPublisher, match.actions, {
        tenantId,
        caseId,
        assigneeId:
          typeof facts['case.assigneeId'] === 'string' ? facts['case.assigneeId'] : null,
        title: typeof context['title'] === 'string' ? context['title'] : null,
      });
    }

    await publishSocketEvent(
      redisPublisher,
      `tenant:${tenantId}`,
      'automation.executed',
      { ruleId: match.ruleId, trigger, context },
    );

    logger.info(`[automation] Rule ${match.ruleId} executed for trigger "${trigger}"`);
  }
}
