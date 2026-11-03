/**
 * CLI token 的建立與撤銷（#337 階段 3 第九批，AGENTS.md 結構規則 2）。
 *
 * 兩個入口寫同一張表：CLI 登入與登出（auth.routes.ts），以及設定頁的 CLI 連線（settings/cli-session.routes.ts）。
 * 兩個入口的規則不同（誰能建立、scope、期限），所以各有自己的 flow，共用 service 的寫入。
 * 建立時先在交易外產生 token 並以 bcrypt 雜湊，再開交易寫入，交易不等 bcrypt。
 * 驗證 token（verifyCliSession）在綁定租戶之前執行，由 auth.plugin 以 prismaAdmin 呼叫，不經過這裡。
 */
import type { PrismaClient } from '@prisma/client';
import { flowOf, inTenant } from '../../lib/tenant-ctx.js';
import type { RequestActor } from '../../lib/request-actor.js';
import {
  createCliSession,
  generateCliToken,
  listCliSessions,
  revokeCliSession,
  type CreateCliSessionInput,
} from './cli-session.service.js';

type Deps = { prisma: PrismaClient };
type IssueInput = Omit<CreateCliSessionInput, 'token'>;

async function issueCliSession(deps: Deps, tenantId: string, input: IssueInput) {
  const token = await generateCliToken();
  const session = await inTenant(deps.prisma, tenantId, (scope) => createCliSession(scope, { ...input, token }));
  return { token: token.token, session };
}

/** CLI 登入：login() 驗完密碼後，為登入的成員建立預設 scope 的 token */
export function issueCliLoginSessionFlow(
  deps: Deps,
  agent: { id: string; tenantId: string },
  name: string,
) {
  return issueCliSession(deps, agent.tenantId, { agentId: agent.id, name });
}

/** CLI 登出：撤銷這次請求使用的 token */
export function revokeCurrentCliSessionFlow(deps: Deps, tenantId: string, sessionId: string) {
  return inTenant(deps.prisma, tenantId, (scope) => revokeCliSession(scope, sessionId));
}

export const listCliSessionsFlow = flowOf(listCliSessions);

/** 設定頁：為操作的成員建立 token，scope 與期限由請求指定 */
export function createCliSessionFlow(
  deps: Deps,
  actor: RequestActor,
  input: { name: string; scopes?: string[]; expiresAt?: Date },
) {
  return issueCliSession(deps, actor.tenantId, { agentId: actor.agentId, ...input });
}

/** 設定頁：撤銷租戶內的任一個 token */
export function revokeCliSessionFlow(deps: Deps, actor: RequestActor, sessionId: string) {
  return inTenant(deps.prisma, actor.tenantId, (scope) => revokeCliSession(scope, sessionId));
}
