import type { FastifyInstance } from 'fastify';
import { logger } from '@open333crm/core';
import { getConfig } from '../../config/env.js';
import { withTenant } from '../../lib/tenant-db.js';
import { setA2ABridgeLiveState } from './a2a-status.service.js';

interface InboxItem {
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

            // 3. Process task through Open333 Agent LLM
            try {
              const tenant = await fastify.prismaAdmin.tenant.findFirst({
                where: { isActive: true },
                orderBy: { createdAt: 'asc' },
              });

              if (!tenant) {
                logger.warn('[A2A] No active tenant found to execute A2A task');
                continue;
              }

              logger.info('[A2A] Processing task via CRM Agent', {
                taskId: item.taskId,
                requester: item.requesterAgentId,
              });

              // Dynamically import runAgentReply to prevent top-level module load side-effects
              const { runAgentReply } = await import('../ai/agent/agent.service.js');

              const agentResult = await withTenant(fastify.prisma, tenant.id, async (tx) => {
                return runAgentReply(tx, {
                  tenantId: tenant.id,
                  userMessage: item.message,
                  canPublishWiki: config.AGENT_WIKI_AUTO_PUBLISH,
                });
              });

              // 4. Send correlated reply back to requester if not [[A2A_NO_REPLY]]
              if (agentResult.text && agentResult.text.trim() !== '[[A2A_NO_REPLY]]') {
                const replyPayload = {
                  taskId: `reply-${item.taskId}-${Date.now()}`,
                  contextId: item.contextId || item.taskId,
                  message: agentResult.text,
                };

                await fetch(`${hubUrl}/hub/v1/agents/${item.requesterAgentId}/tasks`, {
                  method: 'POST',
                  headers: {
                    'X-Agent-ID': agentId,
                    'Authorization': `Bearer ${agentToken}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(replyPayload),
                  signal: abortController?.signal,
                });

                logger.info('[A2A] Sent reply task to requester', {
                  target: item.requesterAgentId,
                  contextId: replyPayload.contextId,
                });
              }
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
