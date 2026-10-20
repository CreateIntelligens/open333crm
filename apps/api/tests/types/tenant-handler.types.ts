/**
 * tenantHandler() 的型別測試（change tenant-transaction-context，design 決策 2）。
 *
 * 交易內程式拿到的 reply 不能送出回應：在交易內送出，等於 commit 之前就告訴前端成功。
 * 本檔不執行，只由 tests/unit/lib/tenant-handler.test.ts 以 tsc 檢查；
 * 每個 @ts-expect-error 都必須真的有錯誤，否則 tsc 失敗。
 */
import type { FastifyInstance } from 'fastify';
import { tenantHandler } from '../../src/lib/tenant-ctx.js';

declare const app: FastifyInstance;

tenantHandler(app, async (_request, reply) => {
  // @ts-expect-error 交易內不能呼叫 send()
  reply.send({});
  // @ts-expect-error code() 回傳的也不是 FastifyReply，不能接著 send()
  reply.code(201).send({});
  reply.code(201).header('x-test', '1').status(202);
  return { success: true };
});
