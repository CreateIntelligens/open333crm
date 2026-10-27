/**
 * agent 的 flow（change migrate-role-agent-tenant-ctx，design 決策 4、7）：交易外的工作、開交易、
 * 呼叫 service、寫稽核。
 *
 * - bcrypt 在開啟交易之前執行，不佔住交易與連線。
 * - 寫入與稽核一起 commit；稽核寫入失敗時整筆 rollback（主規格 tenant-audit-log）。
 * - 稽核的 payload 只放非 PII 摘要：email、密碼都不寫入。
 */
import type { PrismaClient } from '@prisma/client';
import { inTenant } from '../../lib/tenant-ctx.js';
import type { RequestActor } from '../../lib/request-actor.js';
import { AppError } from '../../shared/utils/response.js';
import { hashPassword } from '../../shared/utils/password.js';
import type { ChannelGrantScope } from '../../services/channel-visibility.js';
import { setAgentChannels } from '../../services/channel-team-access.js';
import { recordTenantAudit } from '../tenant-audit/tenant-audit.service.js';
import {
  changeOwnPassword,
  createAgent,
  deactivateAgent,
  purgeAgent,
  reactivateAgent,
  resetAgentPassword,
  updateAgentRole,
} from './agent.service.js';
import type { AgentRoleValue, CreateAgentInput } from './agent.schema.js';

export interface AgentFlowDeps {
  prisma: PrismaClient;
}

/**
 * 建立成員。越權防護在 service：不可指派權限超出自身有效權限的角色（ROLE_ESCALATION 403）。
 * 可見渠道是 fail-closed：建立成員與寫入可見渠道在同一個交易，可指派範圍是 grantable。
 */
export async function createAgentFlow(
  deps: AgentFlowDeps,
  actor: RequestActor,
  input: { data: CreateAgentInput; grantable: ChannelGrantScope },
) {
  const passwordHash = await hashPassword(input.data.password);
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const agent = await createAgent(scope, input.data, actor.roleId, {
      grantable: input.grantable,
      grantedById: actor.agentId,
      passwordHash,
    });
    // email 不入 payload，以 targetId 對應成員
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'agent.create',
      targetType: 'agent',
      targetId: agent.id,
      payload: { role: agent.role },
      ip: actor.ip,
    });
    return agent;
  });
}

/** 改自己的密碼。比對目前的密碼要讀出既有的雜湊，所以在交易內（design 決策 4） */
export async function changeOwnPasswordFlow(
  deps: AgentFlowDeps,
  actor: RequestActor,
  currentPassword: string,
  newPassword: string,
) {
  const newPasswordHash = await hashPassword(newPassword);
  await inTenant(deps.prisma, actor.tenantId, (scope) =>
    changeOwnPassword(scope, actor.agentId, currentPassword, newPasswordHash));
}

/** 指派角色。越權防護（ROLE_ESCALATION 403）與自我降級守門（SELF_LOCK 422）在 service */
export function updateAgentRoleFlow(
  deps: AgentFlowDeps,
  actor: RequestActor,
  agentId: string,
  input: { role?: AgentRoleValue; roleId?: string },
) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const agent = await updateAgentRole(scope, agentId, input, actor.roleId, actor.agentId);
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'agent.role.assign',
      targetType: 'agent',
      targetId: agentId,
      payload: { role: agent.role, roleId: input.roleId ?? null },
      ip: actor.ip,
    });
    return agent;
  });
}

/** 重設別人的密碼。稽核只記操作事實，不記密碼 */
export async function resetAgentPasswordFlow(deps: AgentFlowDeps, actor: RequestActor, agentId: string, newPassword: string) {
  const passwordHash = await hashPassword(newPassword);
  await inTenant(deps.prisma, actor.tenantId, async (scope) => {
    await resetAgentPassword(scope, agentId, passwordHash);
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'agent.password.reset',
      targetType: 'agent',
      targetId: agentId,
      ip: actor.ip,
    });
  });
}

/** 停用（可再啟用、保留 email）。不可停用自己，避免自我鎖定 */
export async function deactivateAgentFlow(deps: AgentFlowDeps, actor: RequestActor, agentId: string) {
  if (actor.agentId === agentId) throw new AppError('不可停用自己的帳號', 'SELF_ACTION_FORBIDDEN', 422);
  await inTenant(deps.prisma, actor.tenantId, async (scope) => {
    await deactivateAgent(scope, agentId);
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'agent.deactivate',
      targetType: 'agent',
      targetId: agentId,
      ip: actor.ip,
    });
  });
}

/** 重新啟用（角色維持停用前） */
export async function reactivateAgentFlow(deps: AgentFlowDeps, actor: RequestActor, agentId: string) {
  await inTenant(deps.prisma, actor.tenantId, async (scope) => {
    await reactivateAgent(scope, agentId);
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'agent.reactivate',
      targetType: 'agent',
      targetId: agentId,
      ip: actor.ip,
    });
  });
}

/** 永久刪除（釋放 email、不可復原）。不可刪除自己：自我鎖定，且稽核的 actorId 會違反外鍵 */
export async function purgeAgentFlow(deps: AgentFlowDeps, actor: RequestActor, agentId: string) {
  if (actor.agentId === agentId) throw new AppError('不可刪除自己的帳號', 'SELF_ACTION_FORBIDDEN', 422);
  await inTenant(deps.prisma, actor.tenantId, async (scope) => {
    await purgeAgent(scope, agentId);
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'agent.purge',
      targetType: 'agent',
      targetId: agentId,
      ip: actor.ip,
    });
  });
}

/** 整組替換成員的可用渠道 */
export function setAgentChannelsFlow(deps: AgentFlowDeps, actor: RequestActor, agentId: string, channelIds: string[]) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const result = await setAgentChannels(scope, agentId, channelIds, actor.agentId);
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'agent.channels.set',
      targetType: 'agent',
      targetId: agentId,
      payload: { count: result.count },
      ip: actor.ip,
    });
    return result;
  });
}
