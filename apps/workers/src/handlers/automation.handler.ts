import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type { Redis as IORedis } from 'ioredis';
import type { ChannelPlugin } from '@open333crm/channel-plugins';
import {
  claimSideEffect,
  collectSkippedClaims,
  dispatchOutboxRows,
  logger,
  writeOutbox,
  type SkippedClaim,
} from '@open333crm/core';
import {
  buildAutomationFacts,
  evaluateRules,
  matchKeywordTrigger,
  validateAutomationRuleContract,
} from '@open333crm/automation';
import { publishSocketEvent } from '../lib/socket-bridge.js';
import { executeWorkerAutomationActions } from '../lib/automation-actions.js';

interface AutomationJobData {
  tenantId: string;
  /** 觸發事件的 id，規則動作以它認領（change outbox-event-delivery）。API 部署前送出的 job 沒有 */
  eventId?: string;
  trigger: string;
  context: Record<string, unknown>;
}

type RuleAction = { type: string; params: Record<string, unknown> };

type RuleRow = {
  id: string;
  name: string;
  priority: number;
  stopOnMatch: boolean;
  conditions: unknown;
  actions: unknown;
  trigger?: unknown;
};

/**
 * automation 佇列的 processor：以回傳值列出被認領擋下的規則動作，管理員重送 job 之後看得出
 * 哪些動作沒有再執行（change queue-monitoring，design 決策 7）。沒有跳過時回傳 undefined。
 */
export async function processAutomationJob(
  job: Job,
  prisma: PrismaClient,
  redisPublisher: IORedis,
  pluginRegistry?: Map<string, ChannelPlugin>,
): Promise<{ skippedClaims: SkippedClaim[] } | undefined> {
  const { skippedClaims } = await collectSkippedClaims(() =>
    handleAutomationJob(job, prisma, redisPublisher, pluginRegistry),
  );
  return skippedClaims.length > 0 ? { skippedClaims } : undefined;
}

export async function handleAutomationJob(
  job: Job,
  prisma: PrismaClient,
  redisPublisher: IORedis,
  pluginRegistry?: Map<string, ChannelPlugin>,
): Promise<void> {
  const { tenantId, eventId, trigger, context } = job.data as AutomationJobData;
  // API 部署前送出的 keyword.matched job 帶 ruleId，只評估那一條規則
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
  await evaluateAndExecute(prisma, redisPublisher, pluginRegistry, { tenantId, eventId, trigger, context, rules });

  // 關鍵字規則在處理收到的訊息時比對（design 決策 9）：API 不再發出 keyword.matched 事件
  if (trigger === 'message.received' && typeof context.messageContent === 'string' && context.messageContent) {
    await evaluateKeywordRules(prisma, redisPublisher, pluginRegistry, { tenantId, eventId, context, text: context.messageContent });
  }
}

/**
 * 命中的每條關鍵字規則：發出 keyword.matched 給對外 webhook（每則訊息每條規則最多一次），
 * 再以 trigger = 'keyword.matched' 執行規則，讓 LINE 照舊用 reply 回覆。
 */
async function evaluateKeywordRules(
  prisma: PrismaClient,
  redisPublisher: IORedis,
  pluginRegistry: Map<string, ChannelPlugin> | undefined,
  input: { tenantId: string; eventId?: string; context: Record<string, unknown>; text: string },
) {
  const keywordRules = await prisma.automationRule.findMany({
    where: { tenantId: input.tenantId, eventType: 'keyword.matched', isActive: true },
  });
  for (const rule of keywordRules) {
    const match = matchKeywordTrigger(rule.trigger, input.text);
    if (!match) continue;
    logger.info(`[automation] keyword.matched: rule="${rule.name}", keywords=[${match.matchedKeywords.join(', ')}]`);

    const context = {
      ...input.context,
      ruleId: rule.id,
      matchedKeywords: match.matchedKeywords,
      matchMode: match.matchMode,
    };
    await emitKeywordMatched(prisma, input.tenantId, input.eventId, rule.id, context);
    await evaluateAndExecute(prisma, redisPublisher, pluginRegistry, {
      tenantId: input.tenantId,
      eventId: input.eventId,
      trigger: 'keyword.matched',
      context,
      rules: [rule],
    });
  }
}

/**
 * 以「keyword_matched + 入站訊息 id + 規則 id」認領，成功才在同一個交易寫 outbox。
 * 舊的 job 沒有入站訊息 id 時，改用事件 id 認領；兩者都沒有就不發出。
 */
async function emitKeywordMatched(
  prisma: PrismaClient,
  tenantId: string,
  eventId: string | undefined,
  ruleId: string,
  context: Record<string, unknown>,
) {
  const sourceId = typeof context.messageId === 'string' ? context.messageId : eventId;
  if (!sourceId) {
    logger.warn(`[automation] keyword.matched not emitted: job has no messageId or eventId (rule ${ruleId})`);
    return;
  }
  // 交易失敗時丟錯：沒有認領也沒有 outbox，只能由 BullMQ 重試這個 job（規則動作已各自認領）
  const row = await prisma.$transaction(async (tx) => {
    if (!(await claimSideEffect(tx, { tenantId, kind: 'keyword_matched', sourceId, subKey: ruleId }))) return null;
    return writeOutbox(tx, { tenantId, kind: 'event', name: 'keyword.matched', payload: context });
  });
  if (!row) return;
  // 快路徑；失敗時資料列留在 outbox，由 API 的 outbox-relay 補送
  await dispatchOutboxRows(prisma, [row]).catch((err: unknown) =>
    logger.error(`[automation] keyword.matched dispatch failed, left for outbox-relay (rule ${ruleId})`, err),
  );
}

async function evaluateAndExecute(
  prisma: PrismaClient,
  redisPublisher: IORedis,
  pluginRegistry: Map<string, ChannelPlugin> | undefined,
  input: { tenantId: string; eventId?: string; trigger: string; context: Record<string, unknown>; rules: RuleRow[] },
) {
  const { tenantId, eventId, trigger, context, rules } = input;
  if (rules.length === 0) return;

  const compatibleRules = rules.filter((rule) => {
    const result = validateAutomationRuleContract({
      eventName: trigger,
      conditions: rule.conditions,
      actions: rule.actions,
      // 含契約沒有的動作（例如 2026-10-05 拿掉的 llm_reply）時驗證失敗、整條略過，規則列表會標示「規則不會執行」。
      // 既有規則中的這類動作已由 migration 20261005100000_remove_retired_automation_actions 清理
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
    // 回覆權杖只在收到事件後 30 秒內安全；沒有收到時間時 selectSafeLineStrategy 一律改用 push（design D25）
    const receivedAt =
      typeof context['receivedAt'] === 'string' ? context['receivedAt'] : null;

    const contactId =
      typeof context['contactId'] === 'string' ? context['contactId'] : null;

    await executeWorkerAutomationActions(prisma, redisPublisher, match.actions, {
      tenantId,
      eventId: eventId ?? null,
      ruleId: match.ruleId,
      // 發券的來源名稱存發券當下的規則名稱（design D27）
      ruleName: ruleInputs.find((rule) => rule.id === match.ruleId)?.name ?? null,
      caseId,
      conversationId,
      contactId,
      trigger,
      replyToken,
      receivedAt,
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
