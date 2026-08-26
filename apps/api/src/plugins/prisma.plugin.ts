import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { tenantScopedClient, type TenantScopedClient } from '../lib/tenant-db.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** 受 RLS 約束的 client（app_tenant 連線）。直接用它裸查租戶表會 fail-closed。 */
    prisma: PrismaClient;
    /** BYPASSRLS client（app_admin 連線），僅白名單跨租戶服務用（平台/登入/scheduler）。 */
    prismaAdmin: PrismaClient;
  }
  interface FastifyRequest {
    /** 綁定本請求租戶的 client：每個操作自動在交易內設 app.current_tenant（受 RLS）。 */
    tenantPrisma: TenantScopedClient;
  }
}

const logConfig =
  process.env.NODE_ENV === 'development'
    ? [
        { emit: 'event', level: 'query' } as const,
        { emit: 'stdout', level: 'error' } as const,
        { emit: 'stdout', level: 'warn' } as const,
      ]
    : [{ emit: 'stdout', level: 'error' } as const];

async function prismaPlugin(fastify: FastifyInstance) {
  // 受 RLS 的租戶連線（app_tenant）。未另設 DATABASE_URL_TENANT 時用預設 DATABASE_URL
  // （漸進上線階段 0：RLS 未 FORCE 時行為與現況一致）。
  const tenantUrl = process.env.DATABASE_URL_TENANT ?? process.env.DATABASE_URL;
  const prisma = new PrismaClient({ log: logConfig, datasources: { db: { url: tenantUrl } } });

  // BYPASSRLS 連線（app_admin）。未設 DATABASE_URL_ADMIN 時 fallback 到 tenant 連線
  // （階段 0 相容：RLS 未開時兩者等價，白名單服務照常運作）。
  const adminUrl = process.env.DATABASE_URL_ADMIN ?? tenantUrl;
  const prismaAdmin =
    adminUrl === tenantUrl
      ? prisma
      : new PrismaClient({ log: logConfig, datasources: { db: { url: adminUrl } } });

  await prisma.$connect();
  if (prismaAdmin !== prisma) await prismaAdmin.$connect();
  fastify.log.info('Prisma connected (tenant%s)', prismaAdmin !== prisma ? ' + admin' : '');

  fastify.decorate('prisma', prisma);
  fastify.decorate('prismaAdmin', prismaAdmin);

  // 每個請求掛一個綁定其租戶的 client（getter：用時才依 request.agent.tenantId 建立）。
  // 無 tenantId（未登入/平台）時取用會拋，那些路徑應改用 prisma/prismaAdmin。
  // 用 null 佔位（型別由 declare module 提供）；實際 getter 於 onRequest 掛上。
  fastify.decorateRequest('tenantPrisma', null as unknown as TenantScopedClient);
  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    // request.agent 由 auth 之後才有；此 hook 早於 auth，故實際綁定延到用時。
    // 提供 getter 讓 handler 取用時才依當前 request.agent.tenantId 建立。
    Object.defineProperty(request, 'tenantPrisma', {
      configurable: true,
      get() {
        const tid = request.agent?.tenantId;
        if (!tid) throw new Error('tenantPrisma 需要已認證的租戶身分（request.agent.tenantId）');
        return tenantScopedClient(prisma, tid);
      },
    });
  });

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
    if (prismaAdmin !== prisma) await prismaAdmin.$disconnect();
    fastify.log.info('Prisma disconnected');
  });
}

export default fp(prismaPlugin, {
  name: 'prisma',
});
