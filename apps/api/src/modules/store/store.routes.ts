/**
 * 門市與門市帳號管理（後台）。Prefix: /api/v1/stores
 * 查看需 store.view，異動需 store.manage（design D13）。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../../guards/rbac.guard.js';
import { getConfig } from '../../config/env.js';
import { tenantHandler, type TenantCtx, type TenantReply } from '../../lib/tenant-ctx.js';
import { AppError } from '../../shared/utils/response.js';
import {
  listStores,
  createStore,
  updateStore,
  createStoreAccount,
  updateStoreAccount,
  resetStoreAccountPassword,
  forceLogoutStoreAccount,
  deleteStoreAccount,
  getStorePoster,
  StoreConflictError,
  StoreValidationError,
} from './store.service.js';

const idParam = z.object({ id: z.string().uuid('格式不正確') });

function notFound(reply: TenantReply) {
  reply.code(404);
  return { success: false, error: { code: 'NOT_FOUND', message: '查無此門市或帳號' } };
}

/** tenantHandler 加上 service 錯誤的轉換（交易會回滾） */
function storeHandler(
  app: FastifyInstance,
  fn: (request: FastifyRequest, reply: TenantReply, ctx: TenantCtx) => Promise<unknown>,
) {
  return tenantHandler(app, async (request, reply, ctx) => {
    try {
      return await fn(request, reply, ctx);
    } catch (err) {
      if (err instanceof StoreValidationError) throw new AppError(err.message, 'VALIDATION_ERROR', 400);
      if (err instanceof StoreConflictError) throw new AppError(err.message, 'CONFLICT', 409);
      throw err;
    }
  });
}

export default async function storeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const view = { preHandler: [requirePermission('store.view')] };
  const manage = { preHandler: [requirePermission('store.manage')] };

  app.get('/', view, storeHandler(app, async (_request, _reply, ctx) => {
    return { success: true, data: await listStores(ctx) };
  }));

  /** 櫃檯海報：核銷台登入頁網址與 QR Code */
  app.get('/:id/poster', view, storeHandler(app, async (request, reply, ctx) => {
    const { id } = idParam.parse(request.params);
    const poster = await getStorePoster(ctx, id, getConfig().WEB_BASE_URL);
    return poster ? { success: true, data: poster } : notFound(reply);
  }));

  app.post('/', manage, storeHandler(app, async (request, _reply, ctx) => {
    const body = z.object({ name: z.string().max(50) }).parse(request.body);
    return { success: true, data: await createStore(ctx, body) };
  }));

  app.patch('/:id', manage, storeHandler(app, async (request, reply, ctx) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ name: z.string().max(50).optional(), isActive: z.boolean().optional() }).parse(request.body);
    const store = await updateStore(ctx, id, body);
    return store ? { success: true, data: store } : notFound(reply);
  }));

  app.post('/:id/accounts', manage, storeHandler(app, async (request, _reply, ctx) => {
    const { id } = idParam.parse(request.params);
    const body = z
      .object({ username: z.string().max(32), password: z.string().max(100), canRedeem: z.boolean().optional() })
      .parse(request.body);
    return { success: true, data: await createStoreAccount(ctx, { storeId: id, ...body }) };
  }));

  app.patch('/accounts/:id', manage, storeHandler(app, async (request, reply, ctx) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ canRedeem: z.boolean().optional(), isActive: z.boolean().optional() }).parse(request.body);
    const account = await updateStoreAccount(ctx, id, body);
    return account ? { success: true, data: account } : notFound(reply);
  }));

  app.post('/accounts/:id/reset-password', manage, storeHandler(app, async (request, reply, ctx) => {
    const { id } = idParam.parse(request.params);
    const { password } = z.object({ password: z.string().max(100) }).parse(request.body);
    const account = await resetStoreAccountPassword(ctx, id, password);
    return account ? { success: true, data: account } : notFound(reply);
  }));

  app.post('/accounts/:id/force-logout', manage, storeHandler(app, async (request, reply, ctx) => {
    const { id } = idParam.parse(request.params);
    const account = await forceLogoutStoreAccount(ctx, id);
    return account ? { success: true, data: account } : notFound(reply);
  }));

  app.delete('/accounts/:id', manage, storeHandler(app, async (request, reply, ctx) => {
    const { id } = idParam.parse(request.params);
    const deleted = await deleteStoreAccount(ctx, id);
    return deleted ? { success: true } : notFound(reply);
  }));
}
