/**
 * 門市與門市帳號管理（後台）。Prefix: /api/v1/stores
 * 查看需 store.view，異動需 store.manage（design D13）。
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../../guards/rbac.guard.js';
import { getConfig } from '../../config/env.js';
import { AppError } from '../../shared/utils/response.js';
import { StoreConflictError, StoreValidationError } from './store.service.js';
import {
  createStoreAccountFlow,
  createStoreFlow,
  deleteStoreAccountFlow,
  forceLogoutStoreAccountFlow,
  getStorePosterFlow,
  listStoresFlow,
  resetStoreAccountPasswordFlow,
  updateStoreAccountFlow,
  updateStoreFlow,
} from './store.flow.js';

const idParam = z.object({ id: z.string().uuid('格式不正確') });

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: '查無此門市或帳號' } });
}

/** service 錯誤轉成 AppError（交易已回滾） */
async function storeErrors<T>(result: Promise<T>): Promise<T> {
  try {
    return await result;
  } catch (err) {
    if (err instanceof StoreValidationError) throw new AppError(err.message, 'VALIDATION_ERROR', 400);
    if (err instanceof StoreConflictError) throw new AppError(err.message, 'CONFLICT', 409);
    throw err;
  }
}

export default async function storeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const view = { preHandler: [requirePermission('store.view')] };
  const manage = { preHandler: [requirePermission('store.manage')] };

  app.get('/', view, async (request) => {
    return { success: true, data: await storeErrors(listStoresFlow(app, request.agent.tenantId)) };
  });

  /** 櫃檯海報：核銷台登入頁網址與 QR Code */
  app.get('/:id/poster', view, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const poster = await storeErrors(getStorePosterFlow(app, request.agent.tenantId, id, getConfig().WEB_BASE_URL));
    return poster ? { success: true, data: poster } : notFound(reply);
  });

  app.post('/', manage, async (request) => {
    const body = z.object({ name: z.string().max(50) }).parse(request.body);
    return { success: true, data: await storeErrors(createStoreFlow(app, request.agent.tenantId, body)) };
  });

  app.patch('/:id', manage, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ name: z.string().max(50).optional(), isActive: z.boolean().optional() }).parse(request.body);
    const store = await storeErrors(updateStoreFlow(app, request.agent.tenantId, id, body));
    return store ? { success: true, data: store } : notFound(reply);
  });

  app.post('/:id/accounts', manage, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z
      .object({ username: z.string().max(32), password: z.string().max(100), canRedeem: z.boolean().optional() })
      .parse(request.body);
    return { success: true, data: await storeErrors(createStoreAccountFlow(app, request.agent.tenantId, { storeId: id, ...body })) };
  });

  app.patch('/accounts/:id', manage, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ canRedeem: z.boolean().optional(), isActive: z.boolean().optional() }).parse(request.body);
    const account = await storeErrors(updateStoreAccountFlow(app, request.agent.tenantId, id, body));
    return account ? { success: true, data: account } : notFound(reply);
  });

  app.post('/accounts/:id/reset-password', manage, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { password } = z.object({ password: z.string().max(100) }).parse(request.body);
    const account = await storeErrors(resetStoreAccountPasswordFlow(app, request.agent.tenantId, id, password));
    return account ? { success: true, data: account } : notFound(reply);
  });

  app.post('/accounts/:id/force-logout', manage, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const account = await storeErrors(forceLogoutStoreAccountFlow(app, request.agent.tenantId, id));
    return account ? { success: true, data: account } : notFound(reply);
  });

  app.delete('/accounts/:id', manage, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const deleted = await storeErrors(deleteStoreAccountFlow(app, request.agent.tenantId, id));
    return deleted ? { success: true } : notFound(reply);
  });
}
