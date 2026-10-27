/**
 * actorOf()：route 從 request 組出 actor（change migrate-role-agent-tenant-ctx，design 決策 7）。
 * 請求沒有租戶身分時回 401，flow 不開交易（主規格 tenant-transaction-context「請求沒有租戶身分」）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { actorOf } from '#src/lib/request-actor.js';

test('請求沒有租戶身分：丟出 401', () => {
  assert.throws(
    () => actorOf({ ip: '127.0.0.1' } as FastifyRequest),
    (err: { statusCode?: number; code?: string }) => err.statusCode === 401 && err.code === 'UNAUTHORIZED',
  );
});

test('組出租戶、成員、角色與 IP；沒有 roleId 時是 null', () => {
  const request = { ip: '10.0.0.1', agent: { id: 'a1', tenantId: 't1', role: 'AGENT' } } as unknown as FastifyRequest;
  assert.deepEqual(actorOf(request), { tenantId: 't1', agentId: 'a1', roleId: null, ip: '10.0.0.1' });
});
