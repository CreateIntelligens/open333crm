import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { success, AppError } from '../../shared/utils/response.js';
import { requirePermission } from '../../guards/rbac.guard.js';
import { listChannelsForAgent, setAgentChannels } from '../../services/channel-team-access.js';
import {
  createAgentSchema,
  updateAgentRoleSchema,
  changePasswordSchema,
  resetPasswordSchema,
} from './agent.schema.js';
import {
  createAgent,
  updateAgentRole,
  changeOwnPassword,
  resetAgentPassword,
  deactivateAgent,
  purgeAgent,
  listAgents,
  reactivateAgent,
} from './agent.service.js';
import { recordTenantAudit } from '../tenant-audit/tenant-audit.service.js';
import { tenantHandler } from '../../lib/tenant-ctx.js';
import { hashPassword } from '../../shared/utils/password.js';
import { resolveChannelGrantScope } from '../../services/channel-visibility.js';

// 每個 handler 在一個綁定租戶的交易內執行（tenantHandler）：寫入與稽核一起 commit。
// bcrypt 在進入交易之前先做，不佔住交易與連線。
export default async function agentRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // GET /api/v1/agents — 啟用中的成員
  fastify.get('/', { preHandler: [requirePermission('agent.view')] }, tenantHandler(fastify, async (_request, _reply, ctx) => {
    return success(await listAgents(ctx, true));
  }));

  // GET /api/v1/agents/inactive — 停用的成員（需 agent.deactivate，供重新啟用，AUDIT AUTH-09）
  fastify.get('/inactive', { preHandler: [requirePermission('agent.deactivate')] }, tenantHandler(fastify, async (_request, _reply, ctx) => {
    return success(await listAgents(ctx, false));
  }));

  // POST /api/v1/agents — 需 agent.manage（建立成員；指派角色受越權防護）
  fastify.post('/', {
    preHandler: [requirePermission('agent.manage')],
  }, async (request, reply) => {
    const body = createAgentSchema.parse(request.body);

    // 越權防護在 service 層：不可指派權限超出自身有效權限的角色（含 legacy 與 roleId）→ ROLE_ESCALATION 403。
    // 渠道可見範圍是 fail-closed：建立成員與寫入可見渠道在同一個交易，可指派範圍依建立者的權限決定。
    const grantable = await resolveChannelGrantScope(request);
    const passwordHash = await hashPassword(body.password);
    return tenantHandler(fastify, async (req, tenantReply, ctx) => {
      const agent = await createAgent(ctx, body, req.agent.roleId, {
        grantable,
        grantedById: req.agent.id,
        passwordHash,
      });
      // 稽核：建立成員（payload 只放非 PII 摘要——email 不入 payload，改用 targetId 對應 agent）
      await recordTenantAudit(ctx, {
        actorId: req.agent.id,
        action: 'agent.create',
        targetType: 'agent',
        targetId: agent.id,
        payload: { role: agent.role },
        ip: req.ip,
      });
      tenantReply.status(201);
      return success(agent);
    })(request, reply);
  });

  // PATCH /api/v1/agents/me/password — any authenticated agent
  // Must be defined before /:id routes to avoid route conflict
  fastify.patch('/me/password', async (request, reply) => {
    const body = changePasswordSchema.parse(request.body);
    const newPasswordHash = await hashPassword(body.newPassword);
    return tenantHandler(fastify, async (req, _tenantReply, ctx) => {
      await changeOwnPassword(ctx, req.agent.id, body.currentPassword, newPasswordHash);
      return success({ message: '密碼已更新' });
    })(request, reply);
  });

  // PATCH /api/v1/agents/:id/role — 需 agent.role.assign（指派角色專用權限；越權防護在 service 層）
  fastify.patch('/:id/role', {
    preHandler: [requirePermission('agent.role.assign')],
  }, tenantHandler(fastify, async (request, _reply, ctx) => {
    const { id } = request.params as { id: string };
    const body = updateAgentRoleSchema.parse(request.body);

    // 越權防護：不可指派權限超出自身有效權限的角色 → ROLE_ESCALATION 403
    // 傳操作者本人 agentId（request.agent.id）供 service 做自我降級守門 → SELF_LOCK 422
    const agent = await updateAgentRole(
      ctx,
      id,
      { role: body.role, roleId: body.roleId },
      request.agent.roleId,
      request.agent.id,
    );
    // 稽核：指派/變更成員角色
    await recordTenantAudit(ctx, {
      actorId: request.agent.id,
      action: 'agent.role.assign',
      targetType: 'agent',
      targetId: id,
      payload: { role: agent.role, roleId: body.roleId ?? null },
      ip: request.ip,
    });
    return success(agent);
  }));

  // PATCH /api/v1/agents/:id/password — 需 agent.password.reset (reset another agent's password)
  fastify.patch('/:id/password', {
    preHandler: [requirePermission('agent.password.reset')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = resetPasswordSchema.parse(request.body);
    const passwordHash = await hashPassword(body.newPassword);
    return tenantHandler(fastify, async (req, _tenantReply, ctx) => {
      await resetAgentPassword(ctx, id, passwordHash);
      // 稽核：重設他人密碼（絕不記錄密碼明文，只記操作事實）
      await recordTenantAudit(ctx, {
        actorId: req.agent.id,
        action: 'agent.password.reset',
        targetType: 'agent',
        targetId: id,
        ip: req.ip,
      });
      return success({ message: '密碼已重設' });
    })(request, reply);
  });

  // POST /api/v1/agents/:id/deactivate — 需 agent.deactivate (停用，可再啟用、保留 email)
  fastify.post('/:id/deactivate', {
    preHandler: [requirePermission('agent.deactivate')],
  }, tenantHandler(fastify, async (request, reply, ctx) => {
    const { id } = request.params as { id: string };
    // 防呆：不可停用自己（避免自我鎖定）
    if (request.agent.id === id) {
      throw new AppError('不可停用自己的帳號', 'SELF_ACTION_FORBIDDEN', 422);
    }
    await deactivateAgent(ctx, id);
    await recordTenantAudit(ctx, {
      actorId: request.agent.id,
      action: 'agent.deactivate',
      targetType: 'agent',
      targetId: id,
      ip: request.ip,
    });
    reply.status(204);
  }));

  // POST /api/v1/agents/:id/reactivate — 需 agent.deactivate（停用可以復原，角色維持停用前）
  fastify.post('/:id/reactivate', {
    preHandler: [requirePermission('agent.deactivate')],
  }, tenantHandler(fastify, async (request, reply, ctx) => {
    const { id } = request.params as { id: string };
    await reactivateAgent(ctx, id);
    await recordTenantAudit(ctx, {
      actorId: request.agent.id,
      action: 'agent.reactivate',
      targetType: 'agent',
      targetId: id,
      ip: request.ip,
    });
    reply.status(204);
  }));

  // DELETE /api/v1/agents/:id — 需 agent.purge (永久刪除、釋放 email、不可復原)
  fastify.delete('/:id', {
    preHandler: [requirePermission('agent.purge')],
  }, tenantHandler(fastify, async (request, reply, ctx) => {
    const { id } = request.params as { id: string };
    // 防呆：不可刪除自己（自我鎖定；且刪除後稽核以已刪 actorId 寫入會撞 FK）
    if (request.agent.id === id) {
      throw new AppError('不可刪除自己的帳號', 'SELF_ACTION_FORBIDDEN', 422);
    }
    await purgeAgent(ctx, id);
    await recordTenantAudit(ctx, {
      actorId: request.agent.id,
      action: 'agent.purge',
      targetType: 'agent',
      targetId: id,
      ip: request.ip,
    });
    reply.status(204);
  }));

  // ─── Agent 直綁渠道（CM-173 延伸）─────────────────────────────────────────
  // 「一個帳號＝一個分店」：人員設定直接勾選可用渠道，可見性與 team 授權取聯集。

  // GET /api/v1/agents/:id/channels — 該成員直綁的渠道
  fastify.get('/:id/channels', {
    preHandler: [requirePermission('channel.assign_team')],
  }, tenantHandler(fastify, async (request, _reply, ctx) => {
    const { id } = request.params as { id: string };
    const rows = await listChannelsForAgent(ctx, id);
    return success(rows);
  }));

  // PUT /api/v1/agents/:id/channels — 整組替換該成員的可用渠道
  fastify.put('/:id/channels', {
    preHandler: [requirePermission('channel.assign_team')],
  }, tenantHandler(fastify, async (request, _reply, ctx) => {
    const { id } = request.params as { id: string };
    const body = z.object({ channelIds: z.array(z.string().uuid()).max(200) }).parse(request.body);
    const result = await setAgentChannels(ctx, id, body.channelIds, request.agent.id);
    await recordTenantAudit(ctx, {
      actorId: request.agent.id,
      action: 'agent.channels.set',
      targetType: 'agent',
      targetId: id,
      payload: { count: result.count },
      ip: request.ip,
    });
    return success(result);
  }));
}
