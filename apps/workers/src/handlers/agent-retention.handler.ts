import type { PrismaClient } from '@prisma/client';

/** Keep the audit row, but clear temporary Agent payloads after three days. */
export async function handleAgentRetentionCleanup(prisma: PrismaClient, now = new Date()) {
  const expiresAt = { lte: now };
  const [runs, toolCalls, drafts] = await Promise.all([
    prisma.agentRun.updateMany({ where: { expiresAt, status: { not: 'EXPIRED' } }, data: { status: 'EXPIRED', finalText: null } }),
    prisma.agentToolCall.updateMany({ where: { expiresAt, status: { not: 'EXPIRED' } }, data: { arguments: {}, result: null, status: 'EXPIRED' } }),
    prisma.agentReportDraft.updateMany({ where: { expiresAt, status: 'DRAFT' }, data: { markdown: null, status: 'EXPIRED' } }),
  ]);
  return { runs: runs.count, toolCalls: toolCalls.count, drafts: drafts.count };
}
