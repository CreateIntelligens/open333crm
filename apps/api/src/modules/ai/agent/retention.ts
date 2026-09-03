export const AGENT_RETENTION_DAYS = 3;
export const AGENT_RETENTION_MS = AGENT_RETENTION_DAYS * 24 * 60 * 60 * 1_000;

export function addRetentionExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + AGENT_RETENTION_MS);
}

export function isAgentExpired(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export interface AgentRetentionStore {
  agentRun: { updateMany(args: unknown): Promise<{ count: number }> };
  agentToolCall: { updateMany(args: unknown): Promise<{ count: number }> };
  agentReportDraft: { updateMany(args: unknown): Promise<{ count: number }> };
}

export async function cleanupExpiredAgentData(store: AgentRetentionStore, now = new Date()) {
  const expiresAt = { lte: now };
  const [runs, toolCalls, drafts] = await Promise.all([
    store.agentRun.updateMany({ where: { expiresAt, status: { not: 'EXPIRED' } }, data: { status: 'EXPIRED', userMessage: '[REDACTED]', finalText: null } }),
    store.agentToolCall.updateMany({ where: { expiresAt, status: { not: 'EXPIRED' } }, data: { arguments: {}, result: null, status: 'EXPIRED' } }),
    store.agentReportDraft.updateMany({ where: { expiresAt, status: 'DRAFT' }, data: { markdown: null, status: 'EXPIRED' } }),
  ]);
  return { runs: runs.count, toolCalls: toolCalls.count, drafts: drafts.count };
}
