import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { success } from '../../shared/utils/response.js';
import { requirePermission } from '../../guards/rbac.guard.js';
import { listChannelsForAgent } from '../../services/channel-team-access.js';
import {
  createAgentSchema,
  updateAgentRoleSchema,
  changePasswordSchema,
  resetPasswordSchema,
} from './agent.schema.js';
import { listAgents } from './agent.service.js';
import {
  changeOwnPasswordFlow,
  createAgentFlow,
  deactivateAgentFlow,
  purgeAgentFlow,
  reactivateAgentFlow,
  resetAgentPasswordFlow,
  setAgentChannelsFlow,
  updateAgentRoleFlow,
} from './agent.flow.js';
import { tenantHandler } from '../../lib/tenant-ctx.js';
import { actorOf } from '../../lib/request-actor.js';
import { resolveChannelGrantScope } from '../../services/channel-visibility.js';

// 查詢以 tenantHandler() 在綁定租戶的交易內執行；寫入都有稽核，經過 agent.flow
//（bcrypt、寫入與稽核的順序都在 flow，AGENTS.md 結構規則 2）。
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

  // POST /api/v1/agents — 需 agent.manage（建立成員；指派角色受越權防護，在 service）
  fastify.post('/', {
    preHandler: [requirePermission('agent.manage')],
  }, async (request, reply) => {
    const body = createAgentSchema.parse(request.body);
    // 可指派的渠道範圍依建立者的權限決定（交易外讀取，design Non-Goals）
    const grantable = await resolveChannelGrantScope(request);
    const agent = await createAgentFlow(fastify, actorOf(request), { data: body, grantable });
    return reply.status(201).send(success(agent));
  });

  // PATCH /api/v1/agents/me/password — any authenticated agent
  // Must be defined before /:id routes to avoid route conflict
  fastify.patch('/me/password', async (request, reply) => {
    const body = changePasswordSchema.parse(request.body);
    await changeOwnPasswordFlow(fastify, actorOf(request), body.currentPassword, body.newPassword);
    return reply.send(success({ message: '密碼已更新' }));
  });

  // PATCH /api/v1/agents/:id/role — 需 agent.role.assign（越權防護與自我降級守門在 service）
  fastify.patch('/:id/role', {
    preHandler: [requirePermission('agent.role.assign')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateAgentRoleSchema.parse(request.body);
    const agent = await updateAgentRoleFlow(fastify, actorOf(request), id, { role: body.role, roleId: body.roleId });
    return reply.send(success(agent));
  });

  // PATCH /api/v1/agents/:id/password — 需 agent.password.reset (reset another agent's password)
  fastify.patch('/:id/password', {
    preHandler: [requirePermission('agent.password.reset')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = resetPasswordSchema.parse(request.body);
    await resetAgentPasswordFlow(fastify, actorOf(request), id, body.newPassword);
    return reply.send(success({ message: '密碼已重設' }));
  });

  // POST /api/v1/agents/:id/deactivate — 需 agent.deactivate (停用，可再啟用、保留 email)
  fastify.post('/:id/deactivate', {
    preHandler: [requirePermission('agent.deactivate')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await deactivateAgentFlow(fastify, actorOf(request), id);
    return reply.status(204).send();
  });

  // POST /api/v1/agents/:id/reactivate — 需 agent.deactivate（停用可以復原，角色維持停用前）
  fastify.post('/:id/reactivate', {
    preHandler: [requirePermission('agent.deactivate')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await reactivateAgentFlow(fastify, actorOf(request), id);
    return reply.status(204).send();
  });

  // DELETE /api/v1/agents/:id — 需 agent.purge (永久刪除、釋放 email、不可復原)
  fastify.delete('/:id', {
    preHandler: [requirePermission('agent.purge')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await purgeAgentFlow(fastify, actorOf(request), id);
    return reply.status(204).send();
  });

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
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ channelIds: z.array(z.string().uuid()).max(200) }).parse(request.body);
    const result = await setAgentChannelsFlow(fastify, actorOf(request), id, body.channelIds);
    return reply.send(success(result));
  });
}
