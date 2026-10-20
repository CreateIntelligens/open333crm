/**
 * 門市與門市帳號管理（後台）。Prefix: /api/v1/stores
 * 查看需 store.view，異動需 store.manage（design D13）。
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../../guards/rbac.guard.js';
import {
  listStores,
  createStore,
  updateStore,
  createStoreAccount,
  updateStoreAccount,
  resetStoreAccountPassword,
  forceLogoutStoreAccount,
  deleteStoreAccount,
  StoreConflictError,
  StoreValidationError,
} from './store.service.js';

const idParam = z.object({ id: z.string().uuid('格式不正確') });
const notFound = { success: false, error: { code: 'NOT_FOUND', message: '查無此門市或帳號' } };

function handleError(err: unknown, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) {
  if (err instanceof StoreValidationError) {
    return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: err.message } });
  }
  if (err instanceof StoreConflictError) {
    return reply.status(409).send({ success: false, error: { code: 'CONFLICT', message: err.message } });
  }
  throw err;
}

export default async function storeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const view = { preHandler: [requirePermission('store.view')] };
  const manage = { preHandler: [requirePermission('store.manage')] };

  app.get('/', view, async (request) => {
    return { success: true, data: await listStores(request.tenantPrisma, request.agent.tenantId) };
  });

  app.post('/', manage, async (request, reply) => {
    const body = z.object({ name: z.string().max(50) }).parse(request.body);
    try {
      return { success: true, data: await createStore(request.tenantPrisma, request.agent.tenantId, body) };
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.patch('/:id', manage, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ name: z.string().max(50).optional(), isActive: z.boolean().optional() }).parse(request.body);
    try {
      const store = await updateStore(request.tenantPrisma, request.agent.tenantId, id, body);
      return store ? { success: true, data: store } : reply.status(404).send(notFound);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/:id/accounts', manage, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z
      .object({ username: z.string().max(32), password: z.string().max(100), canRedeem: z.boolean().optional() })
      .parse(request.body);
    try {
      const account = await createStoreAccount(request.tenantPrisma, request.agent.tenantId, { storeId: id, ...body });
      return { success: true, data: account };
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.patch('/accounts/:id', manage, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ canRedeem: z.boolean().optional(), isActive: z.boolean().optional() }).parse(request.body);
    const account = await updateStoreAccount(request.tenantPrisma, request.agent.tenantId, id, body);
    return account ? { success: true, data: account } : reply.status(404).send(notFound);
  });

  app.post('/accounts/:id/reset-password', manage, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { password } = z.object({ password: z.string().max(100) }).parse(request.body);
    try {
      const account = await resetStoreAccountPassword(request.tenantPrisma, request.agent.tenantId, id, password);
      return account ? { success: true, data: account } : reply.status(404).send(notFound);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/accounts/:id/force-logout', manage, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const account = await forceLogoutStoreAccount(request.tenantPrisma, request.agent.tenantId, id);
    return account ? { success: true, data: account } : reply.status(404).send(notFound);
  });

  app.delete('/accounts/:id', manage, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const deleted = await deleteStoreAccount(request.tenantPrisma, request.agent.tenantId, id);
    return deleted ? { success: true } : reply.status(404).send(notFound);
  });
}
