/**
 * 租戶以 Facebook 登入連結粉專（change fix-meta-webhook-page-routing 第 3 階段）。
 *
 * GET  /status                         是否已設定平台 Meta App（前端決定是否顯示按鈕）
 * POST /start                          產生 Facebook 登入網址
 * GET  /callback                       Facebook 導回（公開，無登入 session；只碰 Redis 與 Graph）
 * GET  /sessions/:connectId/pages      這次授權可連結的粉專（不含 token）
 * POST /sessions/:connectId/connect    連結選定的粉專
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getConfig } from '../../config/env.js';
import { requirePermission } from '../../guards/rbac.guard.js';
import { success } from '../../shared/utils/response.js';
import { getBindingStore } from '../identity-binding/binding-code.js';
import { writeTenantAudit } from '../tenant-audit/tenant-audit.service.js';
import {
  connectPages,
  getMetaAppConfig,
  handleCallback,
  listConnectablePages,
  startConnect,
  type MetaConnectStore,
} from './meta-connect.service.js';

export interface MetaConnectRoutesOptions {
  /** 測試用：替換 Redis */
  store?: MetaConnectStore;
}

const connectIdParams = z.object({ connectId: z.string().min(16).max(64) });
const connectBody = z.object({ pageIds: z.array(z.string().regex(/^\d{1,32}$/, '粉專 ID 格式不正確')).min(1).max(20) });

const actorOf = (request: FastifyRequest) => ({ tenantId: request.agent.tenantId, agentId: request.agent.id });

export default async function metaConnectRoutes(fastify: FastifyInstance, opts: MetaConnectRoutesOptions = {}) {
  const store = () => opts.store ?? getBindingStore();
  const channelsPage = () => `${getConfig().WEB_BASE_URL}/dashboard/settings/channels`;

  fastify.get('/status', { preHandler: [fastify.authenticate, requirePermission('channel.view')] }, async (_request, reply) => {
    return reply.send(success({ configured: getMetaAppConfig() !== null }));
  });

  fastify.post('/start', { preHandler: [fastify.authenticate, requirePermission('channel.create')] }, async (request, reply) => {
    return reply.send(success(await startConnect(store(), actorOf(request))));
  });

  // 公開：Facebook 以瀏覽器導回，沒有我們的登入 session；身分由一次性 state 對回發起者
  fastify.get('/callback', async (request, reply) => {
    const query = z
      .object({ code: z.string().optional(), state: z.string().max(128).optional(), error: z.string().optional() })
      .parse(request.query);
    if (!getMetaAppConfig()) return reply.redirect(`${channelsPage()}?metaConnectError=not_configured`);
    const result = await handleCallback(store(), query);
    const target = result.ok
      ? `${channelsPage()}?metaConnect=${encodeURIComponent(result.connectId)}`
      : `${channelsPage()}?metaConnectError=${result.reason}`;
    return reply.redirect(target);
  });

  fastify.get<{ Params: { connectId: string } }>(
    '/sessions/:connectId/pages',
    { preHandler: [fastify.authenticate, requirePermission('channel.create')] },
    async (request, reply) => {
      const { connectId } = connectIdParams.parse(request.params);
      return reply.send(success(await listConnectablePages(request.tenantPrisma, store(), connectId, actorOf(request))));
    },
  );

  fastify.post<{ Params: { connectId: string } }>(
    '/sessions/:connectId/connect',
    { preHandler: [fastify.authenticate, requirePermission('channel.create')] },
    async (request, reply) => {
      const { connectId } = connectIdParams.parse(request.params);
      const { pageIds } = connectBody.parse(request.body);
      const results = await connectPages(request.tenantPrisma, store(), connectId, actorOf(request), pageIds);
      // 與一般建立渠道相同，每個連結成功的渠道記一筆 channel.create
      for (const r of results) {
        if (r.status !== 'connected') continue;
        await writeTenantAudit(request.tenantPrisma, {
          tenantId: request.agent.tenantId,
          actorId: request.agent.id,
          action: 'channel.create',
          targetType: 'channel',
          targetId: r.channelId,
          payload: { channelType: 'FB', connectMode: 'platform', pageId: r.pageId },
          ip: request.ip,
        });
      }
      return reply.send(success(results));
    },
  );
}
