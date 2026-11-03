/**
 * CLI token 的建立與撤銷（#337 階段 3 第九批，AGENTS.md 結構規則 2）。
 *
 * 兩個入口寫同一張表：CLI 登入與登出（auth.routes.ts），以及設定頁的 CLI 連線（settings/cli-session.routes.ts）。
 * 兩個入口的規則不同（誰能建立、scope、期限、稽核的 action），所以各有自己的 flow，共用 service 的寫入。
 * 建立時先在交易外產生 token 並以 bcrypt 雜湊，再開交易寫入，交易不等 bcrypt。
 * 稽核與 token 在同一個交易寫入（主規格 tenant-audit-log）：稽核寫入失敗時，token 一起 rollback。
 * 驗證 token（verifyCliSession）在綁定租戶之前執行，由 auth.plugin 以 prismaAdmin 呼叫，不經過這裡。
 */
import type { CliSession, PrismaClient } from '@prisma/client';
import { flowOf, inTenant, type TenantScope } from '../../lib/tenant-ctx.js';
import type { RequestActor } from '../../lib/request-actor.js';
import { recordTenantAudit } from '../tenant-audit/tenant-audit.service.js';
import {
  createCliSession,
  generateCliToken,
  listCliSessions,
  parseCliScopes,
  revokeCliSession,
  type CreateCliSessionInput,
} from './cli-session.service.js';

type Deps = { prisma: PrismaClient };
type IssueInput = Omit<CreateCliSessionInput, 'token'>;

/** 稽核記錄的 token 內容，不含明文與雜湊 */
function sessionSummary(session: CliSession) {
  return { name: session.name, scopes: parseCliScopes(session.scopes), expiresAt: session.expiresAt.toISOString() };
}

async function issueCliSession(
  deps: Deps,
  tenantId: string,
  input: IssueInput,
  audit: (scope: TenantScope, session: CliSession) => Promise<void>,
) {
  const token = await generateCliToken();
  const session = await inTenant(deps.prisma, tenantId, async (scope) => {
    const created = await createCliSession(scope, { ...input, token });
    await audit(scope, created);
    return created;
  });
  return { token: token.token, session };
}

/** CLI 登入：login() 驗完密碼後，為登入的成員建立預設 scope 的 token */
export function issueCliLoginSessionFlow(
  deps: Deps,
  agent: { id: string; tenantId: string },
  name: string,
  ip: string,
) {
  return issueCliSession(deps, agent.tenantId, { agentId: agent.id, name }, (scope, session) =>
    recordTenantAudit(scope, {
      actorId: agent.id,
      action: 'cli_session.login',
      targetType: 'cli_session',
      targetId: session.id,
      payload: sessionSummary(session),
      ip,
    }),
  );
}

/** CLI 登出：撤銷這次請求使用的 token。撤銷的筆數是 0 時（兩次登出同時送出）不寫稽核 */
export function revokeCurrentCliSessionFlow(deps: Deps, actor: RequestActor, sessionId: string) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    if ((await revokeCliSession(scope, sessionId)) === 0) return;
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'cli_session.logout',
      targetType: 'cli_session',
      targetId: sessionId,
      ip: actor.ip,
    });
  });
}

export const listCliSessionsFlow = flowOf(listCliSessions);

/** 設定頁：為操作的成員建立 token，scope 與期限由請求指定 */
export function createCliSessionFlow(
  deps: Deps,
  actor: RequestActor,
  input: { name: string; scopes?: string[]; expiresAt?: Date },
) {
  return issueCliSession(deps, actor.tenantId, { agentId: actor.agentId, ...input }, (scope, session) =>
    recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'settings.update',
      targetType: 'settings',
      payload: { section: 'cli-sessions', operation: 'create', sessionId: session.id, ...sessionSummary(session) },
      ip: actor.ip,
    }),
  );
}

/** 設定頁：撤銷租戶內的任一個 token。撤銷的筆數是 0 時（不存在、另一個租戶、已撤銷）不寫稽核 */
export function revokeCliSessionFlow(deps: Deps, actor: RequestActor, sessionId: string) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    if ((await revokeCliSession(scope, sessionId)) === 0) return;
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'settings.update',
      targetType: 'settings',
      payload: { section: 'cli-sessions', operation: 'revoke', sessionId },
      ip: actor.ip,
    });
  });
}
