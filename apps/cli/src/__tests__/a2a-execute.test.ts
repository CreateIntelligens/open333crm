import assert from 'node:assert/strict';
import { executeA2aCommand, clearA2aTaskCache, type A2AExecuteDependencies } from '../commands/a2a/execute.js';

function deps(overrides: Partial<A2AExecuteDependencies> = {}): A2AExecuteDependencies {
  return {
    getProfile: () => ({ host: 'https://crm.example.com', profile: 'default' }),
    readToken: async () => 'cli-token',
    createClient: () => ({
      post: async () => ({ text: 'CRM reply' }),
    }),
    readStdin: async () => '',
    isEnabled: () => true,
    getTimeoutMs: () => 120_000,
    ...overrides,
  };
}

// 1. Basic execution
{
  clearA2aTaskCache();
  const calls: unknown[] = [];
  const logs: string[] = [];
  await executeA2aCommand({ profile: 'default', message: '  hello from bridge  ' }, { log: (value) => logs.push(String(value)) }, deps({
    createClient: () => ({ post: async (_path: string, body: unknown) => { calls.push(body); return { text: 'reply' }; } }),
  }));
  assert.deepEqual(calls, [{ userMessage: 'hello from bridge' }]);
  assert.deepEqual(logs, ['reply']);
}

// 2. Read from stdin
{
  clearA2aTaskCache();
  const logs: string[] = [];
  await executeA2aCommand({ profile: 'default' }, { log: (value) => logs.push(String(value)) }, deps({ readStdin: async () => '\nfrom stdin\n' }));
  assert.deepEqual(logs, ['CRM reply']);
}

// 3. Custom timeout
{
  clearA2aTaskCache();
  let timeoutMs = 0;
  await executeA2aCommand({ profile: 'default', message: 'hello-timeout' }, { log: () => undefined }, deps({
    getTimeoutMs: () => 45_000,
    createClient: (options) => { timeoutMs = options.timeoutMs; return { post: async () => ({ text: 'reply' }) }; },
  }));
  assert.equal(timeoutMs, 45_000);
}

// 4. Anti-echo [[A2A_NO_REPLY]]
{
  clearA2aTaskCache();
  const logs: string[] = [];
  await executeA2aCommand({ profile: 'default', message: 'acknowledge only' }, { log: (value) => logs.push(String(value)) }, deps({
    createClient: () => ({ post: async () => ({ text: '[[A2A_NO_REPLY]]' }) }),
  }));
  assert.deepEqual(logs, ['[[A2A_NO_REPLY]]']);
}

// 5. Invalid timeout rejection
{
  clearA2aTaskCache();
  await assert.rejects(
    () => executeA2aCommand({ profile: 'default', message: 'hello' }, { log: () => undefined }, deps({ getTimeoutMs: () => { throw new Error('invalid timeout'); } })),
    (error: unknown) => error instanceof Error && error.message.includes('invalid timeout'),
  );
}

// 6. Empty prompt rejection
{
  clearA2aTaskCache();
  await assert.rejects(
    () => executeA2aCommand({ profile: 'default' }, { log: () => undefined }, deps()),
    (error: unknown) => error instanceof Error && error.message.includes('A2A prompt is required'),
  );
}

// 7. Oversized prompt rejection
{
  clearA2aTaskCache();
  let called = false;
  const oversized = 'x'.repeat(20_001);
  await assert.rejects(
    () => executeA2aCommand({ profile: 'default', message: oversized }, { log: () => undefined }, deps({ createClient: () => { called = true; return { post: async () => ({ text: 'nope' }) }; } })),
    (error: unknown) => error instanceof Error && error.message.includes('20,000'),
  );
  assert.equal(called, false);
}

// 8. Feature gate rejection
{
  clearA2aTaskCache();
  await assert.rejects(
    () => executeA2aCommand({ profile: 'default', message: 'hello' }, { log: () => undefined }, deps({ isEnabled: () => false })),
    (error: unknown) => error instanceof Error && error.message.includes('A2A CRM adapter is disabled'),
  );
}

// 9. Idempotency & deduplication on repeated task/prompt delivery (Task 3.2)
{
  clearA2aTaskCache();
  let postCount = 0;
  const logs: string[] = [];
  const testDeps = deps({
    createClient: () => ({
      post: async () => {
        postCount++;
        return { text: 'idempotent answer' };
      },
    }),
  });

  // First execution
  await executeA2aCommand({ profile: 'default', message: 'duplicate-test', taskId: 'task-101' }, { log: (v) => logs.push(String(v)) }, testDeps);
  // Repeated delivery (e.g. bridge reconnect retry with same taskId)
  await executeA2aCommand({ profile: 'default', message: 'duplicate-test', taskId: 'task-101' }, { log: (v) => logs.push(String(v)) }, testDeps);

  assert.equal(postCount, 1, 'Subsequent delivery with same taskId must return cached result without hitting API');
  assert.equal(logs.length, 2);
  assert.equal(logs[0], 'idempotent answer');
  assert.equal(logs[1], 'idempotent answer');
}

// 10. Single-flight coalescing for concurrent in-flight requests (Task 3.2)
{
  clearA2aTaskCache();
  let postCount = 0;
  const logs: string[] = [];
  const testDeps = deps({
    createClient: () => ({
      post: async () => {
        postCount++;
        await new Promise((r) => setTimeout(r, 50));
        return { text: 'coalesced reply' };
      },
    }),
  });

  await Promise.all([
    executeA2aCommand({ profile: 'default', message: 'concurrent-msg' }, { log: (v) => logs.push(String(v)) }, testDeps),
    executeA2aCommand({ profile: 'default', message: 'concurrent-msg' }, { log: (v) => logs.push(String(v)) }, testDeps),
  ]);

  assert.equal(postCount, 1, 'Concurrent requests with same prompt must coalesce to 1 in-flight API call');
  assert.equal(logs.length, 2);
}

// 11. Signal cancellation support (Task 3.4)
{
  clearA2aTaskCache();
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => executeA2aCommand(
      { profile: 'default', message: 'aborted-msg', signal: controller.signal },
      { log: () => undefined },
      deps({
        createClient: () => ({
          post: async (_path: string, _body: unknown, options?: { signal?: AbortSignal }) => {
            if (options?.signal?.aborted) {
              const err = new Error('Request aborted');
              err.name = 'AbortError';
              throw err;
            }
            return { text: 'never' };
          },
        }),
      }),
    ),
  );
}

console.log('all a2a execute and resilience tests passed');
