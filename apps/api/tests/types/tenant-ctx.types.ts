/**
 * TenantCtx 與副作用函式的型別測試（change migrate-role-agent-tenant-ctx，design 決策 6）。
 *
 * notifyTenant 與 notifyAgent 只收各自種類的推播名稱。service 拿到的 TenantCtx 不能登記副作用。
 * 本檔不執行，只由 tests/unit/lib/route-flow.test.ts 以 tsc 檢查；
 * 每個 @ts-expect-error 都必須真的有錯誤，否則 tsc 失敗。
 */
import type { Server } from 'socket.io';
import type { TenantCtx, TenantScope } from '../../src/lib/tenant-ctx.js';
import { notifyAgent, notifyTenant } from '../../src/events/socket-push.js';

declare const io: Server;

export function flowStep(scope: TenantScope, ctx: TenantCtx) {
  notifyTenant(scope, io, 'case.updated', {});
  notifyAgent(scope, io, 'agent-1', 'notification.new', {});
  // @ts-expect-error notifyTenant 只收全租戶推播的名稱
  notifyTenant(scope, io, 'notification.new', {});
  // @ts-expect-error notifyAgent 只收給客服人員的推播名稱
  notifyAgent(scope, io, 'agent-1', 'case.updated', {});
  // @ts-expect-error service 收的 TenantCtx 沒有 afterCommit
  ctx.afterCommit('x', () => {});
  // @ts-expect-error 推播要 TenantScope：service 不能推播
  notifyTenant(ctx, io, 'case.updated', {});
}
