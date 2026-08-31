import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type IORedis from 'ioredis';
import type { ChannelPlugin } from '@open333crm/channel-plugins';
import { logger } from '@open333crm/core';
import { evaluateRules, validateAutomationRuleContract } from '@open333crm/automation';
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
  pluginRegistry?: Map<string, ChannelPlugin>,
): Promise<void> {
  const { tenantId, trigger, context } = job.data as AutomationJobData;
  const matchedKeywordRuleId =
    trigger === 'keyword.matched' && typeof context.ruleId === 'string'
      ? context.ruleId
      : undefined;

  const rules = await prisma.automationRule.findMany({
    where: {
      tenantId,
      eventType: trigger,
      isActive: true,
      ...(matchedKeywordRuleId ? { id: matchedKeywordRuleId } : {}),
    },
  });

  if (rules.length === 0) return;

  const compatibleRules = rules.filter((rule) => {
    const result = validateAutomationRuleContract({
      eventName: trigger,
      conditions: rule.conditions,
      actions: rule.actions,
    });
    if (!result.valid) {
      logger.warn(
        `[automation] Rule ${rule.id} skipped: ${result.errors.join('; ')}`,
      );
      return false;
    }
    return true;
  });

  if (compatibleRules.length === 0) return;

  const ruleInputs = compatibleRules.map((rule) => ({
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
    `[automation] ${matched.length}/${compatibleRules.length} rule(s) matched trigger "${trigger}" for tenant ${tenantId}`,
  );

  for (const match of matched) {
    const caseId =
      typeof facts['caseId'] === 'string'
        ? facts['caseId']
        : typeof facts['case.id'] === 'string'
          ? facts['case.id']
          : null;

    const conversationId =
      typeof context['conversationId'] === 'string' ? context['conversationId'] : null;
    const replyToken =
      typeof context['replyToken'] === 'string' ? context['replyToken'] : null;

    const contactId =
      typeof context['contactId'] === 'string' ? context['contactId'] : null;

    await executeWorkerAutomationActions(prisma, redisPublisher, match.actions, {
      tenantId,
      caseId,
      conversationId,
      contactId,
      trigger,
      replyToken,
      assigneeId:
        typeof facts['case.assigneeId'] === 'string' ? facts['case.assigneeId'] : null,
      title: typeof context['title'] === 'string' ? context['title'] : null,
      pluginRegistry,
    });

    await publishSocketEvent(
      redisPublisher,
      `tenant:${tenantId}`,
      'automation.executed',
      { ruleId: match.ruleId, trigger, context },
    );

    logger.info(`[automation] Rule ${match.ruleId} executed for trigger "${trigger}"`);
  }
}
