/**
 * 佇列監控測試用的 Fastify 應用（change queue-monitoring）。
 *
 * 走真實的 auth.plugin、cookie 與 queue-monitoring.routes，trustProxy 與正式環境相同。
 * Prisma 換成只有平台帳號與平台稽核的記憶體版本；佇列由呼叫端給，預設沒有佇列。
 */
process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.JWT_SECRET ||= 'test-queue-monitoring-tenant-secret';
process.env.PLATFORM_JWT_SECRET ||= 'test-queue-monitoring-platform-secret';
process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';

import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import type { Queue } from 'bullmq';
import { TRUSTED_PROXIES } from '#src/lib/trust-proxy.js';

export const QUEUES_PATH = '/api/v1/platform/queues';
export const PLATFORM_USER_ID = '33333333-3333-4333-8333-333333333333';
export const OFFICE_IP = '60.248.142.10';
export const OUTSIDE_IP = '203.0.113.5';

export interface PlatformUserRow {
  id: string;
  isActive: boolean;
  mustChangePassword: boolean;
}

export interface QueueMonitoringApp {
  app: FastifyInstance;
  users: Map<string, PlatformUserRow>;
  audits: Array<Record<string, unknown>>;
  platformToken(payload?: Record<string, unknown>): string;
  tenantToken(): string;
  /** 以平台 JWT 換發監控 cookie，回傳 `name=value` */
  sessionCookie(ip?: string): Promise<string>;
  inject(opts: InjectOptions & { ip?: string; cookie?: string }): ReturnType<FastifyInstance['inject']>;
}

export async function buildQueueMonitoringApp(options: {
  allowedCidrs?: string;
  queues?: Queue[];
  /** 一併註冊平台後台的其他路由（platform.routes） */
  withPlatformRoutes?: boolean;
} = {}): Promise<QueueMonitoringApp> {
  const { default: authPlugin } = await import('#src/plugins/auth.plugin.js');
  const { default: cookiePlugin } = await import('#src/plugins/cookie.plugin.js');
  const { default: errorHandlerPlugin } = await import('#src/plugins/error-handler.plugin.js');
  const { default: queueMonitoringRoutes } = await import('#src/modules/queue-monitoring/queue-monitoring.routes.js');
  const { loadEnvConfig } = await import('#src/config/env.js');
  loadEnvConfig();

  const users = new Map<string, PlatformUserRow>([
    [PLATFORM_USER_ID, { id: PLATFORM_USER_ID, isActive: true, mustChangePassword: false }],
  ]);
  const audits: Array<Record<string, unknown>> = [];
  const prisma = {
    platformUser: {
      findUnique: async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null,
    },
    plan: { findMany: async () => [] },
    platformAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return data;
      },
    },
  };

  const app = Fastify({ trustProxy: TRUSTED_PROXIES });
  app.decorate('prisma', prisma as never);
  app.decorate('prismaAdmin', prisma as never);
  await app.register(errorHandlerPlugin);
  await app.register(cookiePlugin);
  await app.register(authPlugin);
  await app.register(queueMonitoringRoutes, {
    prefix: QUEUES_PATH,
    allowedCidrs: options.allowedCidrs,
    queues: options.queues ?? [],
  });
  if (options.withPlatformRoutes) {
    const { default: platformRoutes } = await import('#src/modules/platform/platform.routes.js');
    await app.register(platformRoutes, { prefix: '/api/v1/platform' });
  }
  await app.ready();

  const platformJwt = (app.jwt as unknown as { platform: { sign: (p: object) => string } }).platform;
  const platformToken = (payload: Record<string, unknown> = { platformUserId: PLATFORM_USER_ID, role: 'PLATFORM_SUPERUSER' }) =>
    platformJwt.sign(payload);

  const inject = (opts: InjectOptions & { ip?: string; cookie?: string }) => {
    const { ip, cookie, headers, ...rest } = opts;
    return app.inject({
      ...rest,
      remoteAddress: ip ?? OFFICE_IP,
      headers: { ...(headers ?? {}), ...(cookie ? { cookie } : {}) },
    });
  };

  return {
    app,
    users,
    audits,
    platformToken,
    tenantToken: () => app.jwt.sign({ agentId: 'a1', tenantId: 't1', role: 'ADMIN', roleId: null, typ: 'access' }),
    async sessionCookie(ip?: string) {
      const res = await inject({
        method: 'POST',
        url: `${QUEUES_PATH}/session`,
        ip,
        headers: { authorization: `Bearer ${platformToken()}` },
      });
      const setCookie = [res.headers['set-cookie']].flat()[0];
      if (!setCookie) throw new Error(`換發監控 cookie 失敗：${res.statusCode} ${res.body}`);
      return setCookie.split(';')[0];
    },
    inject,
  };
}
