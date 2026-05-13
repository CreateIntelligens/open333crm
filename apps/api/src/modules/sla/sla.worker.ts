import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { logger } from '@open333crm/core';

/**
 * @deprecated SLA scanning is owned by apps/workers through BullMQ `sla:poll`.
 * This function is intentionally a no-op so the API process cannot accidentally
 * start an in-process SLA polling timer.
 */
export function setupSlaWorker(_prisma: PrismaClient, _io: SocketIOServer): void {
  logger.warn('[SlaWorker] API in-process SLA scanner is disabled; use apps/workers sla:poll');
}
