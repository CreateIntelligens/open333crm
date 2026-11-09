/**
 * canvas 的 feature 測試共用的租戶與 app（change migrate-canvas-tenant-ctx）。
 *
 * 每個測試檔建立 A、B 兩個專用租戶，結束時整個刪除。路由走真實的 requirePermission 與
 * app_tenant 連線（RLS）。
 */
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import canvasRoutes from '#src/modules/canvas/canvas.routes.js';

loadEnvConfig();

export async function createCanvasFixture(name: string) {
  const owner = new PrismaClient();
  const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
  const mark = `ci-canvas-${name}-${Date.now()}`;
  const A = (await owner.tenant.create({ data: { name: `${mark}-a` } })).id;
  const B = (await owner.tenant.create({ data: { name: `${mark}-b` } })).id;
  const apps: Array<{ close(): Promise<unknown> }> = [];

  async function makeAgent(tenantId: string, roleName: string, codes: string[]) {
    const role = await owner.role.create({
      data: {
        tenantId,
        slug: `${mark}-${roleName}`,
        name: roleName,
        permissions: { create: codes.map((permissionCode) => ({ permissionCode })) },
      },
    });
    const agent = await owner.agent.create({
      data: { tenantId, roleId: role.id, name: roleName, email: `${mark}-${roleName}-${tenantId}@example.test`, passwordHash: 'x' },
    });
    return { id: agent.id, tenantId, roleId: role.id };
  }

  /** 以指定權限的成員建立只註冊 canvas 路由的 app */
  async function buildApp(tenantId: string, roleName: string, codes: string[] = ['canvas.use']) {
    const agent = await makeAgent(tenantId, roleName, codes);
    const app = Fastify();
    await app.register(errorHandlerPlugin);
    app.decorate('prisma', tenantDb);
    app.decorate('prismaAdmin', owner);
    app.decorate('authenticate', async (request: FastifyRequest) => {
      request.agent = { id: agent.id, tenantId, role: 'ADMIN', roleId: agent.roleId } as never;
      (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, tenantId);
    });
    await app.register(canvasRoutes, { prefix: '/api/v1/canvas' });
    await app.ready();
    apps.push(app);
    return app;
  }

  const flowOf = (tenantId: string, status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED', label: string) =>
    owner.interactionFlow.create({ data: { tenantId, name: `${mark}-${label}`, triggerType: 'manual', status } });

  const contactOf = (tenantId: string, label: string) =>
    owner.contact.create({ data: { tenantId, displayName: `${mark}-${label}` } });

  async function cleanup() {
    await Promise.all(apps.map((app) => app.close()));
    for (const tenantId of [A, B]) {
      await owner.flowExecution.deleteMany({ where: { tenantId } });
      await owner.interactionFlow.deleteMany({ where: { tenantId } });
      await owner.contact.deleteMany({ where: { tenantId } });
      await owner.agent.deleteMany({ where: { tenantId } });
      await owner.role.deleteMany({ where: { tenantId } });
      await owner.tenant.delete({ where: { id: tenantId } });
    }
    await Promise.all([owner.$disconnect(), tenantDb.$disconnect()]);
  }

  return { owner, mark, A, B, buildApp, flowOf, contactOf, cleanup };
}

type App = Awaited<ReturnType<Awaited<ReturnType<typeof createCanvasFixture>>['buildApp']>>;

export async function call(app: App, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) {
  const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }) });
  return { status: res.statusCode, body: res.json() as { data: any; meta?: any; error?: { code: string; message: string } } };
}
