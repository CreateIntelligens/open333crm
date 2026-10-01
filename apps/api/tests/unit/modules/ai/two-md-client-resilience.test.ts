import assert from 'node:assert/strict';
import {
  SingleFlightManager,
  BoundedMemoryCache,
  NodeHealthTracker,
  readThrough2md,
  searchThrough2md,
  delay,
} from '../modules/ai/agent/web-client.js';

// 1. Test SingleFlightManager coalescing
{
  const sf = new SingleFlightManager();
  let executionCount = 0;

  const runTask = async () => {
    return sf.do('shared-key', async () => {
      executionCount++;
      await delay(50);
      return 'task-result';
    });
  };

  // Dispatch 5 concurrent calls
  const results = await Promise.all([runTask(), runTask(), runTask(), runTask(), runTask()]);

  assert.equal(executionCount, 1, 'SingleFlight must execute underlying function exactly once for concurrent identical calls');
  assert.deepEqual(results, ['task-result', 'task-result', 'task-result', 'task-result', 'task-result']);
  assert.equal(sf.inFlightCount, 0, 'In-flight count must return to 0 after settling');
}

// 2. Test BoundedMemoryCache
{
  const cache = new BoundedMemoryCache<string>(3);
  cache.set('a', 'alpha', 100);
  cache.set('b', 'beta', 100);
  cache.set('c', 'gamma', 100);

  assert.equal(cache.get('a'), 'alpha');
  assert.equal(cache.get('b'), 'beta');

  // Test capacity eviction (maxEntries = 3)
  cache.set('d', 'delta', 100);
  assert.equal(cache.size, 3, 'Cache size should not exceed maxEntries');

  // Test TTL expiry
  const expiringCache = new BoundedMemoryCache<string>(10);
  expiringCache.set('temp', 'value', 30);
  assert.equal(expiringCache.get('temp'), 'value');
  await delay(40);
  assert.equal(expiringCache.get('temp'), undefined, 'Expired cache entry must return undefined');
}

// 3. Test NodeHealthTracker Circuit Breaker
{
  const tracker = new NodeHealthTracker({ maxFailures: 2, cooldownMs: 80 });
  const nodes = ['https://node-1.test', 'https://node-2.test', 'https://node-3.test'] as const;

  assert.equal(tracker.isAvailable('https://node-1.test'), true);

  // 1st failure: still available
  tracker.recordFailure('https://node-1.test');
  assert.equal(tracker.isAvailable('https://node-1.test'), true);

  // 2nd failure: reaches threshold -> enters cooldown (OPEN state)
  tracker.recordFailure('https://node-1.test');
  assert.equal(tracker.isAvailable('https://node-1.test'), false, 'Node should be in cooldown after maxFailures');

  // Prioritized nodes should bypass node-1 immediately
  const prioritized = tracker.getPrioritizedNodes(nodes);
  assert.deepEqual(prioritized, ['https://node-2.test', 'https://node-3.test'], 'Cooling node must be bypassed in prioritized list');

  // After cooldown expires, node-1 should become available again
  await delay(90);
  assert.equal(tracker.isAvailable('https://node-1.test'), true, 'Node should be available again after cooldown');

  // On success, failures reset
  tracker.recordSuccess('https://node-1.test');
  assert.equal(tracker.isAvailable('https://node-1.test'), true);
}

// 4. Test readThrough2md with Single-Flight and Failover Circuit Breaker
{
  let fetchCallCount = 0;
  const customHealth = new NodeHealthTracker({ maxFailures: 1, cooldownMs: 500 });
  const customSF = new SingleFlightManager();

  const mockFetch: typeof fetch = async (url) => {
    fetchCallCount++;
    const urlStr = url.toString();
    if (urlStr.startsWith('https://node-failing.test')) {
      return new Response('internal error', { status: 500 });
    }
    return new Response(JSON.stringify({ data: { content: '# Success from node-backup' } }), { status: 200 });
  };

  const testNodes = ['https://node-failing.test', 'https://node-backup.test'] as const;

  // First read: failing node fails, backup node succeeds, failing node marked unhealthy
  const res1 = await readThrough2md('https://example.com/article', mockFetch, {
    baseUrls: testNodes,
    healthTracker: customHealth,
    singleFlight: customSF,
    skipCache: true,
  });

  assert.equal(res1.content, '# Success from node-backup');
  assert.equal(res1.source, 'https://node-backup.test');
  assert.equal(customHealth.isAvailable('https://node-failing.test'), false, 'Failing node should be in cooldown');

  // Second read: should immediately bypass failing node and query backup node directly
  const callsBefore = fetchCallCount;
  const res2 = await readThrough2md('https://example.com/another', mockFetch, {
    baseUrls: testNodes,
    healthTracker: customHealth,
    singleFlight: customSF,
    skipCache: true,
  });

  assert.equal(res2.content, '# Success from node-backup');
  // Should only have called backup node (1 fetch call, zero wasted calls on failing node)
  assert.equal(fetchCallCount - callsBefore, 1, 'Should directly query healthy node without hitting cooling node');
}

// 5. Test searchThrough2md single-flight coalescing
{
  let searchFetchCalls = 0;
  const customSF = new SingleFlightManager();

  const mockSearchFetch: typeof fetch = async () => {
    searchFetchCalls++;
    await delay(30);
    return new Response(JSON.stringify({
      data: [{ title: 'Single Flight Result', url: 'https://example.com/sf', content: 'Testing single flight' }]
    }), { status: 200 });
  };

  // Launch 3 simultaneous searches for the exact same query
  const [s1, s2, s3] = await Promise.all([
    searchThrough2md('crm customer search', mockSearchFetch, {
      baseUrls: ['https://mock-search.test'],
      singleFlight: customSF,
      skipCache: true,
    }),
    searchThrough2md('crm customer search', mockSearchFetch, {
      baseUrls: ['https://mock-search.test'],
      singleFlight: customSF,
      skipCache: true,
    }),
    searchThrough2md('crm customer search', mockSearchFetch, {
      baseUrls: ['https://mock-search.test'],
      singleFlight: customSF,
      skipCache: true,
    }),
  ]);

  assert.equal(searchFetchCalls, 1, 'Concurrent identical searches must only execute 1 fetch via SingleFlight');
  assert.equal(s1.results[0].title, 'Single Flight Result');
  assert.equal(s2.results[0].title, 'Single Flight Result');
  assert.equal(s3.results[0].title, 'Single Flight Result');
}

console.log('two-md-client-resilience tests passed');
