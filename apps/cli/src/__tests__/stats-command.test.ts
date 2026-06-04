import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const configHome = `/tmp/open333-cli-stats-test-${Date.now()}`;
mkdirSync(configHome, { recursive: true });

process.env.XDG_CONFIG_HOME = configHome;
process.env.OPEN333_TOKEN = 'cli_test_token';

const { saveProfile } = await import('../config-store.js');
const { statsCommand } = await import('../commands/stats.js');
const { CliError } = await import('../errors.js');

saveProfile({
  host: 'http://open333.test',
  profile: 'stats-test',
  agentId: '11111111-1111-4111-8111-111111111111',
  agentEmail: 'agent@example.test',
  agentName: 'CLI Agent',
  tenantId: '22222222-2222-4222-8222-222222222222',
});

function success(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function analyticsPayload(url: string): Response {
  if (url.includes('/overview')) {
    return success({
      totalMessages: 10,
      inboundMessages: 6,
      outboundMessages: 4,
      openCases: 2,
      newCases: 3,
      resolvedCases: 1,
      slaAchievementRate: 75,
      avgFirstResponseMinutes: 12.3,
      avgResolutionMinutes: 45.6,
      csatAvg: 4.2,
      csatPositiveRate: 80,
    });
  }
  if (url.includes('/message-trend')) {
    return success([{ date: '2026-06-01', LINE: 10, total: 10 }]);
  }
  if (url.includes('/cases')) {
    return success({
      trend: [{ date: '2026-06-01', opened: 3, closed: 1 }],
      categoryDistribution: [{ name: '查詢', value: 2 }],
      priorityDistribution: [{ name: 'HIGH', value: 1 }],
      statusDistribution: [{ name: 'OPEN', value: 2 }],
      escalationRate: 33,
      slaViolationCount: 1,
    });
  }
  if (url.includes('/channels')) {
    return success({
      messagesByChannel: [{ name: 'LINE', value: 10 }],
      conversationsByChannel: [{ name: 'LINE', value: 4 }],
      botVsHuman: [{ name: '人工處理', value: 4 }],
      newContactsByChannel: [{ name: 'LINE', value: 2 }],
    });
  }
  if (url.includes('/my')) {
    return success({
      agentId: '11111111-1111-4111-8111-111111111111',
      name: 'CLI Agent',
      role: 'ADMIN',
      casesHandled: 3,
      casesResolved: 1,
      avgFirstResponseMinutes: 12.3,
      avgResolutionMinutes: 45.6,
      csatAvg: 4.2,
      slaAchievementRate: 75,
      pendingCases: 2,
      slaSoonExpiring: 1,
    });
  }
  return new Response(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'not found' } }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}

async function testTextOutput() {
  const calls: string[] = [];
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    calls.push(String(input));
    return analyticsPayload(String(input));
  }) as typeof fetch;

  const lines: string[] = [];
  await statsCommand({ profile: 'stats-test', from: '2026-06-01', to: '2026-06-30' }, { log: (line) => lines.push(line) });

  assert.equal(calls.length, 5);
  assert.equal(calls.every((url) => url.startsWith('http://open333.test/api/v1/cli/analytics/')), true);
  assert.equal(lines.includes('Overview'), true);
  assert.equal(lines.some((line) => line.includes('Messages: 10')), true);
  assert.equal(lines.some((line) => line.includes('CLI Agent')), true);
}

async function testJsonOutput() {
  globalThis.fetch = (async (input: URL | RequestInfo) => analyticsPayload(String(input))) as typeof fetch;

  const lines: string[] = [];
  await statsCommand({ profile: 'stats-test', json: true }, { log: (line) => lines.push(line) });

  const data = JSON.parse(lines.join('\n'));
  assert.equal(data.overview.totalMessages, 10);
  assert.equal(data.cases.slaViolationCount, 1);
}

async function testInsufficientScope() {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({
      success: false,
      error: { code: 'INSUFFICIENT_SCOPE', message: 'CLI token requires cli:analytics:read scope' },
    }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

  await assert.rejects(
    () => statsCommand({ profile: 'stats-test' }, { log: () => undefined }),
    (error: unknown) => error instanceof CliError
      && error.code === 'INSUFFICIENT_SCOPE'
      && error.message.includes('cli:analytics:read'),
  );
}

await testTextOutput();
await testJsonOutput();
await testInsufficientScope();

console.log('stats-command tests passed');
process.exit(0);
