/**
 * knowledge 的 feature 測試共用的租戶與 app（change migrate-knowledge-tenant-ctx）。
 *
 * 每個測試檔建立 A、B 兩個專用租戶，結束時整個刪除。路由走真實的 requirePermission 與
 * app_tenant 連線（RLS）。
 */
import Fastify, { type FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import cookie from '@fastify/cookie';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import authPlugin from '#src/plugins/auth.plugin.js';
import knowledgeRoutes from '#src/modules/knowledge/knowledge.routes.js';
import type { KnowledgeEffects, UploadFile } from '#src/modules/knowledge/knowledge-effects.js';

loadEnvConfig();

export const ALL_KNOWLEDGE = ['knowledge.view', 'knowledge.manage', 'knowledge.admin'];

/** 記錄呼叫的向量化與儲存服務（design D1）。各函式可以換成自訂的實作，例如讓上傳失敗 */
export function recordingEffects() {
  const rec = {
    embedded: [] as Array<{ tenantId: string; articleId: string }>,
    uploaded: [] as string[],
    removed: [] as string[],
    embedImpl: async (_tenantId: string, _articleId: string): Promise<void> => {},
    uploadImpl: (async (_buffer, filename, _mime, tenantId, directory, subPath) => {
      const key = [tenantId, directory, subPath, `${crypto.randomUUID()}-${filename}`].filter(Boolean).join('/');
      return { key, url: `https://storage.test/${key}` };
    }) as UploadFile,
    removeImpl: async (_key: string): Promise<void> => {},
  };
  const effects: KnowledgeEffects = {
    embed: (tenantId, articleId) => {
      rec.embedded.push({ tenantId, articleId });
      return rec.embedImpl(tenantId, articleId);
    },
    storage: {
      upload: async (...args) => {
        const result = await rec.uploadImpl(...args);
        rec.uploaded.push(result.key);
        return result;
      },
      remove: (key) => {
        rec.removed.push(key);
        return rec.removeImpl(key);
      },
    },
  };
  return { rec, effects };
}

export async function createKnowledgeFixture(name: string) {
  const owner = new PrismaClient();
  const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
  const mark = `ci-knowledge-${name}-${Date.now()}`;
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

  /**
   * 以指定權限的成員建立只註冊 knowledge 路由的 app。
   * `realAuth` 時改用真實的 auth.plugin，回傳的 `token` 是該成員的 access token
   */
  async function buildApp(tenantId: string, roleName: string, codes: string[] = ALL_KNOWLEDGE, opts: { realAuth?: boolean } = {}) {
    const agent = await makeAgent(tenantId, roleName, codes);
    const { rec, effects } = recordingEffects();
    const app = Fastify();
    await app.register(multipart);
    await app.register(errorHandlerPlugin);
    app.decorate('prisma', tenantDb);
    app.decorate('prismaAdmin', owner);
    if (opts.realAuth) {
      await app.register(cookie);
      await app.register(authPlugin);
    } else {
      const authenticate = async (request: FastifyRequest) => {
        request.agent = { id: agent.id, tenantId, role: 'ADMIN', roleId: agent.roleId } as never;
        (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(tenantDb, tenantId);
      };
      app.decorate('authenticate', authenticate);
      app.decorate('authenticateJwtOrPartnerKey', authenticate);
    }
    await app.register(knowledgeRoutes, { prefix: '/api/v1/knowledge', effects });
    await app.ready();
    apps.push(app);
    const token = opts.realAuth
      ? app.jwt.sign({ agentId: agent.id, tenantId, role: 'AGENT', roleId: agent.roleId, typ: 'access' } as never)
      : undefined;
    return { app, agentId: agent.id, rec, token };
  }

  const articleOf = (tenantId: string, label: string, data: Partial<{ status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'; category: string; externalDocId: string; externalVer: number }> = {}) =>
    owner.kmArticle.create({
      data: {
        tenantId,
        title: `${mark}-${label}`,
        content: `${label} 的內容`,
        summary: '',
        category: data.category ?? '一般',
        tags: [],
        status: data.status ?? 'DRAFT',
        createdById: '00000000-0000-4000-8000-000000000000',
        externalDocId: data.externalDocId,
        externalVer: data.externalVer,
      },
    });

  const feedbackOf = (tenantId: string, articleId: string) =>
    owner.kbArticleFeedback.create({ data: { tenantId, articleId, rating: 'bad', status: 'open' } });

  async function cleanup() {
    await Promise.all(apps.map((app) => app.close()));
    for (const tenantId of [A, B]) {
      await owner.kbArticleFeedback.deleteMany({ where: { tenantId } });
      await owner.kmArticle.deleteMany({ where: { tenantId } });
      await owner.tenantSettings.deleteMany({ where: { tenantId } });
      await owner.agent.deleteMany({ where: { tenantId } });
      await owner.role.deleteMany({ where: { tenantId } });
      await owner.tenant.delete({ where: { id: tenantId } });
    }
    await Promise.all([owner.$disconnect(), tenantDb.$disconnect()]);
  }

  return { owner, mark, A, B, buildApp, articleOf, feedbackOf, cleanup };
}

type App = Awaited<ReturnType<Awaited<ReturnType<typeof createKnowledgeFixture>>['buildApp']>>['app'];

export async function call(app: App, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
  const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }) });
  return {
    status: res.statusCode,
    body: res.json() as { data: any; meta?: any; error?: { code: string; message: string; details?: any } },
  };
}

/** 合作方推送的 multipart 請求內容 */
export function partnerForm(fields: Record<string, string>, files: Array<{ filename: string; content: Buffer; mime?: string }> = []) {
  const boundary = '----open333-partner-boundary';
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  for (const file of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="Attached"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.mime ?? 'application/pdf'}\r\n\r\n`,
      ),
      file.content,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat(parts) };
}

/** 內容偵測認得的最小 PDF（同 upload-content-detector.test.ts） */
export const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
