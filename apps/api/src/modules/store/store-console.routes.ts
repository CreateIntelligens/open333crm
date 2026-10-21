/**
 * 店員核銷台。Prefix: /api/v1/store-console
 *
 * 不用座席登入：以門市帳號登入取得門市憑證（design D13）。除了登入與登入頁的門市名稱，
 * 每個端點都檢查帳號狀態，依錯誤碼讓前端顯示對應說明（spec「核銷台每次操作都檢查帳號狀態」）。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { getBindingStore } from '../identity-binding/binding-code.js';
import { storeLoginLookups } from '../auth/store-account-login.js';
import {
  authorizeStoreSession,
  isExpiredStoreToken,
  listTodayRedemptions,
  loginStoreAccount,
  lookupStoreCoupon,
  redeemAtStore,
  StoreRedeemInProgressError,
  verifyStoreToken,
  type AuthorizedStore,
  type StoreConsoleDeps,
  type StoreSession,
  type StoreSessionError,
} from './store-console.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    storeSession?: StoreSession;
    storeAuth?: AuthorizedStore;
  }
}

const SESSION_ERRORS: Record<StoreSessionError | 'SESSION_EXPIRED' | 'UNAUTHORIZED', { status: number; message: string }> = {
  UNAUTHORIZED: { status: 401, message: '請先登入核銷台' },
  SESSION_EXPIRED: { status: 401, message: '登入已過期，請重新登入' },
  STORE_ACCOUNT_NOT_FOUND: { status: 401, message: '找不到此門市帳號，請聯絡店長或總部確認' },
  PASSWORD_CHANGED: { status: 401, message: '密碼已更改，請向店長確認最新密碼' },
  SESSION_REVOKED: { status: 401, message: '此裝置已被登出，請重新登入' },
  STORE_ACCOUNT_DISABLED: { status: 403, message: '此門市帳號已停用，請聯絡店長或總部確認' },
  STORE_CLOSED: { status: 403, message: '門市已停止營運，請聯絡總部' },
  TENANT_DISABLED: { status: 403, message: '商家的核銷服務已停用，請聯絡總部' },
  NO_REDEEM_PERMISSION: { status: 403, message: '沒有核銷權限，請聯絡店長或總部開啟核銷權限' },
};

function sendSessionError(reply: FastifyReply, code: keyof typeof SESSION_ERRORS) {
  const { status, message } = SESSION_ERRORS[code];
  return reply.status(status).send({ success: false, error: { code, message } });
}

export default async function storeConsoleRoutes(app: FastifyInstance) {
  const lookups = storeLoginLookups(app);
  const deps = (): StoreConsoleDeps => ({ store: getBindingStore(), resolveTenant: lookups.resolveTenant });

  // 登入防暴力嘗試；帳號另有錯 5 次鎖 15 分鐘
  await app.register(rateLimit, { global: true, max: 120, timeWindow: '1 minute', keyGenerator: (request) => request.ip });

  /** 驗證門市憑證並檢查帳號狀態；requireRedeem 為 true 時另檢查核銷權限 */
  const guard = (requireRedeem: boolean) => async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const session = token ? verifyStoreToken(token) : null;
    if (!session) return sendSessionError(reply, token && isExpiredStoreToken(token) ? 'SESSION_EXPIRED' : 'UNAUTHORIZED');
    const auth = await authorizeStoreSession(app.prisma, session, { requireRedeem });
    if (!auth.ok) return sendSessionError(reply, auth.code);
    request.storeSession = session;
    request.storeAuth = auth;
  };

  app.post('/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = z
      .object({ username: z.string().min(1).max(64), password: z.string().min(1).max(100), remember: z.boolean().default(true) })
      .parse(request.body);
    const result = await loginStoreAccount(app.prisma, deps(), body.username, body.password, body.remember);
    if (result.ok) return { success: true, data: result };
    if (result.code === 'INVALID_CREDENTIALS') {
      return reply.status(401).send({ success: false, error: { code: result.code, message: '帳號或密碼錯誤' } });
    }
    if (result.code === 'ACCOUNT_LOCKED') {
      return reply.status(423).send({
        success: false,
        error: { code: result.code, message: '密碼錯誤次數過多，帳號暫時鎖定', details: { lockedUntil: result.lockedUntil } },
      });
    }
    return sendSessionError(reply, result.code);
  });

  /** 登入頁顯示的門市名稱（海報 QR 帶門市 id）。查無時回 404，不透露其他資料。 */
  app.get('/stores/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const name = await lookups.publicStoreName(id);
    return name ? { success: true, data: { name } } : reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: '查無此門市' } });
  });

  app.get('/me', { preHandler: guard(false) }, async (request) => {
    const auth = request.storeAuth!;
    return { success: true, data: { account: auth.account, store: auth.store } };
  });

  /** 查券：只讀，不改變券的狀態 */
  app.get('/lookup', { preHandler: guard(true) }, async (request) => {
    const { code } = z.object({ code: z.string().min(1).max(64) }).parse(request.query);
    return { success: true, data: await lookupStoreCoupon(app.prisma, request.storeSession!, code) };
  });

  /** 確認核銷。key 為前端每次確認時產生的重試鍵，網路重送時沿用同一個 */
  app.post('/redeem', { preHandler: guard(true) }, async (request, reply) => {
    const body = z.object({ code: z.string().min(1).max(64), key: z.string().min(8).max(64) }).parse(request.body);
    let result;
    try {
      result = await redeemAtStore(app.prisma, deps(), request.storeSession!, body.code, body.key);
    } catch (err) {
      // 同一個重試鍵的上一次核銷還沒完成：前端視為網路不穩，沿用同一個鍵重送即可取得結果
      if (err instanceof StoreRedeemInProgressError) {
        return reply.status(503).send({
          success: false,
          error: { code: 'REDEEM_IN_PROGRESS', message: '上一次核銷還在處理中，請稍候再按一次' },
        });
      }
      throw err;
    }
    // 核銷失敗（已使用、過期等）是業務結果，不是請求錯誤：照常回 200，由 data.ok 區分
    return { success: true, data: result };
  });

  app.get('/today', { preHandler: guard(true) }, async (request) => {
    return { success: true, data: await listTodayRedemptions(app.prisma, request.storeSession!) };
  });
}
