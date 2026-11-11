import type { FastifyInstance } from 'fastify';
import { logger } from '@open333crm/core';
import { getConfig } from '../../config/env.js';
import type { PrismaClient } from '@open333crm/database';
import type { Redis } from 'ioredis';
import { setA2ABridgeLiveState } from './a2a-status.service.js';

export interface InboxItem {
  sequence: number;
  taskId: string;
  contextId?: string;
  requesterAgentId: string;
  targetAgentId: string;
  message: string;
  createdAt: string;
}

interface InboxResponse {
  items: InboxItem[];
  nextSequence: number;
}

export interface A2ATaskDeps {
  /** app_tenant 的基礎連線，Agent 的每一步以 inTenant() 開交易 */
  prisma: PrismaClient;
  /** 找執行任務的租戶（平台層資料表 tenants） */
  prismaAdmin: Pick<PrismaClient, 'tenant'>;
  redis: Redis;
  hub: { url: string; agentId: string; agentToken: string };
  canPublishWiki: boolean;
  signal?: AbortSignal;
  /** 測試換成假的 fetch */
  fetchImpl?: typeof fetch;
}

/**
 * 處理一個 A2A 任務：以 CRM Agent 執行，把結果回給發送方。
 * Agent 不包在交易內：每一步各自開短交易，LLM 與工具在交易外呼叫
 * （change migrate-ai-agent-tenant-ctx，design D4）。任務以最早建立的啟用租戶執行，見 AUDIT A2A-01。
 */
export async function handleA2ATask(deps: A2ATaskDeps, item: InboxItem): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const tenant = await deps.prismaAdmin.tenant.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!tenant) {
    logger.warn('[A2A] No active tenant found to execute A2A task');
    return;
  }

  logger.info('[A2A] Processing task via CRM Agent', {
    taskId: item.taskId,
    requester: item.requesterAgentId,
  });

  // Dynamically import the Agent flow to prevent top-level module load side-effects
  const { runAgentReplyFlow } = await import('../ai/agent/agent.flow.js');
  const { createOutboxPublisher } = await import('../../events/outbox-publisher.js');
  const llm = { prisma: deps.prisma, redis: deps.redis, events: createOutboxPublisher(deps.prisma) };

  const agentResult = await runAgentReplyFlow({ prisma: deps.prisma, llm }, {
    tenantId: tenant.id,
    userMessage: item.message,
    canPublishWiki: deps.canPublishWiki,
  });

  // Send correlated reply back to requester if not [[A2A_NO_REPLY]]
  if (agentResult.text && agentResult.text.trim() !== '[[A2A_NO_REPLY]]') {
    const replyPayload = {
      taskId: `reply-${item.taskId}-${Date.now()}`,
      contextId: item.contextId || item.taskId,
      message: agentResult.text,
    };

    await fetchImpl(`${deps.hub.url}/hub/v1/agents/${item.requesterAgentId}/tasks`, {
      method: 'POST',
      headers: {
        'X-Agent-ID': deps.hub.agentId,
        'Authorization': `Bearer ${deps.hub.agentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(replyPayload),
      signal: deps.signal,
    });

    logger.info('[A2A] Sent reply task to requester', {
      target: item.requesterAgentId,
      contextId: replyPayload.contextId,
    });
  }
}

let isRunning = false;
let abortController: AbortController | null = null;
let lastSeenSequence = 0;

export async function startA2ABridgeWorker(fastify: FastifyInstance): Promise<void> {
  const config = getConfig();
  if (!config.A2A_BRIDGE_ENABLED) {
    setA2ABridgeLiveState('disabled');
    return;
  }

  const hubUrl = config.A2A_HUB_URL.replace(/\/+$/, '');
  const agentId = config.A2A_AGENT_ID;
  const agentToken = config.A2A_AGENT_TOKEN;

  if (!agentId || !agentToken) {
    logger.warn('[A2A] Bridge enabled but A2A_AGENT_ID or A2A_AGENT_TOKEN is missing');
    setA2ABridgeLiveState('not_reported');
    return;
  }

  isRunning = true;
  abortController = new AbortController();
  setA2ABridgeLiveState('connected');

  logger.info('[A2A] Starting live A2A Bridge worker', { hubUrl, agentId: `${agentId.slice(0, 6)}…${agentId.slice(-4)}` });

  // Hook cleanup on server close
  fastify.addHook('onClose', async () => {
    stopA2ABridgeWorker();
  });

  // Start non-blocking polling loop in background
  (async () => {
    while (isRunning && !abortController?.signal.aborted) {
      try {
        const inboxUrl = `${hubUrl}/hub/v1/agents/${agentId}/inbox?afterSequence=${lastSeenSequence}`;
        const res = await fetch(inboxUrl, {
          method: 'GET',
          headers: {
            'X-Agent-ID': agentId,
            'Authorization': `Bearer ${agentToken}`,
          },
          signal: abortController?.signal,
        });

        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            logger.error('[A2A] Authentication failed against Hub', { status: res.status });
            setA2ABridgeLiveState('not_reported');
          }
          await sleep(5000, abortController?.signal);
          continue;
        }

        setA2ABridgeLiveState('connected');
        const data = (await res.json()) as InboxResponse;

        if (Array.isArray(data.items) && data.items.length > 0) {
          for (const item of data.items) {
            if (item.sequence > lastSeenSequence) {
              lastSeenSequence = item.sequence;
            }

            // 1. Instant ACK immediately
            try {
              await fetch(`${hubUrl}/hub/v1/agents/${agentId}/inbox/${item.sequence}/ack`, {
                method: 'POST',
                headers: {
                  'X-Agent-ID': agentId,
                  'Authorization': `Bearer ${agentToken}`,
                },
                signal: abortController?.signal,
              });
            } catch (ackErr) {
              logger.warn('[A2A] Failed to ACK task sequence', { sequence: item.sequence, err: ackErr });
            }

            // 2. Anti-echo guard: ignore self-sent messages
            if (item.requesterAgentId === agentId) {
              continue;
            }

            // 3. 以 CRM Agent 處理任務，4. 把結果回給發送方
            try {
              await handleA2ATask(
                {
                  prisma: fastify.prisma,
                  prismaAdmin: fastify.prismaAdmin,
                  redis: fastify.redis,
                  hub: { url: hubUrl, agentId, agentToken },
                  canPublishWiki: config.AGENT_WIKI_AUTO_PUBLISH,
                  signal: abortController?.signal,
                },
                item,
              );
            } catch (execErr) {
              logger.error('[A2A] Failed to execute CRM Agent for A2A task', { taskId: item.taskId, err: execErr });
            }
          }
        }

        // Wait between polling cycles
        await sleep(2500, abortController?.signal);
      } catch (err: unknown) {
        if (abortController?.signal.aborted) break;
        logger.error('[A2A] Unexpected error in Bridge polling cycle', { err });
        await sleep(5000, abortController?.signal);
      }
    }
  })();
}

export function stopA2ABridgeWorker(): void {
  isRunning = false;
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    }
  });
}
