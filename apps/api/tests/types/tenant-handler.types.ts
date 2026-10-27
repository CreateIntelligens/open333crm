/**
 * tenantHandler() 的型別測試（change tenant-transaction-context，design 決策 2）。
 *
 * 交易內程式拿到的 reply 不能送出回應：在交易內送出，等於 commit 之前就告訴前端成功。
 * notifyTenant 與 notifyAgent 只收各自種類的推播名稱（design 決策 6）。
 * service 與 tenantHandler() 拿到的 TenantCtx 不能登記副作用（change migrate-role-agent-tenant-ctx，決策 6、7）。
 * 本檔不執行，只由 tests/unit/lib/tenant-handler.test.ts 以 tsc 檢查；
 * 每個 @ts-expect-error 都必須真的有錯誤，否則 tsc 失敗。
 */
import type { FastifyInstance } from 'fastify';
import type { Server } from 'socket.io';
import { tenantHandler, type TenantCtx, type TenantScope } from '../../src/lib/tenant-ctx.js';
import { notifyAgent, notifyTenant } from '../../src/events/socket-push.js';

declare const app: FastifyInstance;
declare const io: Server;

tenantHandler(app, async (_request, reply) => {
  // @ts-expect-error 交易內不能呼叫 send()
  reply.send({});
  // @ts-expect-error code() 回傳的也不是 FastifyReply，不能接著 send()
  reply.code(201).send({});
  reply.code(201).header('x-test', '1').status(202);
  return { success: true };
});

tenantHandler(app, async (_request, _reply, ctx) => {
  // @ts-expect-error tenantHandler() 的 handler 只拿到 TenantCtx，沒有副作用的 route 才用它
  ctx.afterCommit('x', () => {});
  // @ts-expect-error 推播要 TenantScope：有副作用的 route 要經過 flow
  notifyTenant(ctx, io, 'case.updated', {});
  return { success: true };
});

export function flowStep(scope: TenantScope, ctx: TenantCtx) {
  notifyTenant(scope, io, 'case.updated', {});
  notifyAgent(scope, io, 'agent-1', 'notification.new', {});
  // @ts-expect-error notifyTenant 只收全租戶推播的名稱
  notifyTenant(scope, io, 'notification.new', {});
  // @ts-expect-error notifyAgent 只收給客服人員的推播名稱
  notifyAgent(scope, io, 'agent-1', 'case.updated', {});
  // @ts-expect-error service 收的 TenantCtx 沒有 afterCommit
  ctx.afterCommit('x', () => {});
}
