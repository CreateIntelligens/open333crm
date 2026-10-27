/**
 * 執行操作的成員與請求來源（change migrate-role-agent-tenant-ctx，design 決策 7）。
 *
 * route 從 request 組出 actor 交給 flow，flow 不讀 request：同一個 flow 也能由 HTTP 之外的入口呼叫。
 */
import type { FastifyRequest } from 'fastify';

export interface RequestActor {
  tenantId: string;
  agentId: string;
  /** 越權與自鎖判斷用；過渡期可能為 null（尚未回填） */
  roleId: string | null;
  /** 寫進稽核的來源 IP */
  ip: string;
}

export function actorOf(request: FastifyRequest): RequestActor {
  return {
    tenantId: request.agent.tenantId,
    agentId: request.agent.id,
    roleId: request.agent.roleId ?? null,
    ip: request.ip,
  };
}
