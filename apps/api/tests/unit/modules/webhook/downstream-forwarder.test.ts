import assert from 'node:assert/strict';
import {
  downstreamWebhookConfigSchema,
  getDownstreamWebhookConfig,
  isBlockedUrl,
  forwardToDownstream,
  type DownstreamWebhookConfig,
} from '../modules/webhook/downstream-forwarder.js';
import {
  extractEventIds,
  claimForForward,
  type LoopGuardStore,
} from '../modules/webhook/downstream-loop-guard.js';

const PUBLIC_URL = 'https://8.8.8.8/line-hook'; // IP literal → no network DNS, not blocked

async function testConfigParsing() {
  // valid + enabled → returns config with defaulted forwardHeaders
  const cfg = getDownstreamWebhookConfig({
    downstreamWebhook: { enabled: true, url: PUBLIC_URL, mode: 'after' },
  });
  assert.ok(cfg);
  assert.equal(cfg.mode, 'after');
  assert.equal(cfg.url, PUBLIC_URL);

  // disabled → null
  assert.equal(
    getDownstreamWebhookConfig({ downstreamWebhook: { enabled: false, url: PUBLIC_URL, mode: 'after' } }),
    null,
  );
  // missing key → null
  assert.equal(getDownstreamWebhookConfig({ foo: 1 }), null);
  assert.equal(getDownstreamWebhookConfig(null), null);
  // malformed (http url) → null (fail-safe)
  assert.equal(
    getDownstreamWebhookConfig({ downstreamWebhook: { enabled: true, url: 'http://x.com', mode: 'after' } }),
    null,
  );
  // malformed (bad mode) → null
  assert.equal(
    getDownstreamWebhookConfig({ downstreamWebhook: { enabled: true, url: PUBLIC_URL, mode: 'sideways' } }),
    null,
  );
}

async function testSchemaValidation() {
  assert.equal(downstreamWebhookConfigSchema.safeParse({ enabled: true, url: PUBLIC_URL, mode: 'immediate' }).success, true);
  // non-https rejected
  assert.equal(downstreamWebhookConfigSchema.safeParse({ enabled: true, url: 'http://x.com', mode: 'immediate' }).success, false);
  // bad mode rejected
  assert.equal(downstreamWebhookConfigSchema.safeParse({ enabled: true, url: PUBLIC_URL, mode: 'x' }).success, false);
}

async function testSsrfGuard() {
  assert.equal(await isBlockedUrl('http://8.8.8.8/'), true, 'non-https blocked');
  assert.equal(await isBlockedUrl('https://127.0.0.1/'), true, 'loopback blocked');
  assert.equal(await isBlockedUrl('https://10.1.2.3/'), true, 'private 10/8 blocked');
  assert.equal(await isBlockedUrl('https://192.168.0.5/'), true, 'private 192.168 blocked');
  assert.equal(await isBlockedUrl('https://169.254.1.1/'), true, 'link-local blocked');
  assert.equal(await isBlockedUrl('https://[::1]/'), true, 'ipv6 loopback blocked');
  assert.equal(await isBlockedUrl(PUBLIC_URL), false, 'public IP allowed');
}

async function withFetchStub(
  impl: (url: string, init: RequestInit) => Promise<Response>,
  run: () => Promise<void>,
) {
  const orig = globalThis.fetch;
  (globalThis as { fetch: unknown }).fetch = impl as unknown;
  try {
    await run();
  } finally {
    (globalThis as { fetch: unknown }).fetch = orig;
  }
}

async function testForwardPassesOriginalHeaders() {
  const rawBody = Buffer.from(JSON.stringify({ events: [{ type: 'message' }] }));
  const cfg: DownstreamWebhookConfig = { enabled: true, url: PUBLIC_URL, mode: 'immediate' };
  let captured: { url: string; init: RequestInit } | null = null;

  await withFetchStub(
    async (url, init) => {
      captured = { url, init };
      return new Response(null, { status: 500 }); // non-ok → must be ignored
    },
    () =>
      forwardToDownstream(
        cfg,
        rawBody,
        {
          'content-type': 'application/json',
          'x-line-signature': 'sig-abc',
          host: 'our.domain',
          'content-length': '999',
        },
        { id: 'chan-1' },
      ),
  );

  assert.ok(captured, 'fetch was called');
  assert.equal(captured!.url, PUBLIC_URL);
  assert.equal(captured!.init.body, rawBody, 'forwards original raw body bytes unchanged');
  const h = captured!.init.headers as Record<string, string>;
  // original headers relayed unchanged
  assert.equal(h['content-type'], 'application/json', 'original content-type kept');
  assert.equal(h['x-line-signature'], 'sig-abc', 'original signature header passed through');
  // transport-level headers stripped (undici sets them for the new target)
  assert.equal(h['host'], undefined, 'host stripped');
  assert.equal(h['content-length'], undefined, 'content-length stripped');
  // nothing added, no signing, no forward-mode header
  assert.equal(h['X-Open333-Channel-Id'], undefined);
  assert.equal(h['X-Open333-Forward-Mode'], undefined);
  assert.equal(h['X-Open333-Signature'], undefined);
}

async function testForwardBlocksSsrfTarget() {
  const cfg: DownstreamWebhookConfig = { enabled: true, url: 'https://127.0.0.1/hook', mode: 'immediate' };
  let called = false;
  await withFetchStub(
    async () => {
      called = true;
      return new Response(null, { status: 200 });
    },
    () => forwardToDownstream(cfg, Buffer.from('{}'), {}, { id: 'chan-1' }),
  );
  assert.equal(called, false, 'SSRF target must NOT be fetched');
}

async function testForwardIsBestEffortOnThrow() {
  const cfg: DownstreamWebhookConfig = { enabled: true, url: PUBLIC_URL, mode: 'after' };
  await withFetchStub(
    async () => {
      throw new Error('connection refused');
    },
    async () => {
      // must resolve without throwing — result ignored
      await forwardToDownstream(cfg, Buffer.from('{}'), {}, { id: 'chan-1' });
    },
  );
}

// ─── Loop guard ───────────────────────────────────────────────────────────

class FakeStore implements LoopGuardStore {
  private keys = new Set<string>();
  async set(key: string, _v: string, _ex: 'EX', _s: number, _nx: 'NX'): Promise<'OK' | null> {
    if (this.keys.has(key)) return null;
    this.keys.add(key);
    return 'OK';
  }
}

function lineBody(events: unknown[]): Buffer {
  return Buffer.from(JSON.stringify({ destination: 'Uxxx', events }));
}

async function testExtractEventIds() {
  assert.deepEqual(extractEventIds(lineBody([{ webhookEventId: 'w1' }, { webhookEventId: 'w2' }])), ['w1', 'w2']);
  assert.deepEqual(extractEventIds(lineBody([{ replyToken: 'r1' }])), ['r1'], 'falls back to replyToken');
  assert.deepEqual(extractEventIds(lineBody([{ webhookEventId: 'w1', replyToken: 'r1' }])), ['w1'], 'prefers webhookEventId');
  assert.deepEqual(extractEventIds(lineBody([])), []);
  assert.deepEqual(extractEventIds(Buffer.from('not json')), []);
}

async function testLoopGuardBreaksLoop() {
  const store = new FakeStore();
  const payload = lineBody([{ webhookEventId: 'w1' }]);
  assert.equal(await claimForForward('c1', payload, store), true, 'first sighting → forward');
  assert.equal(await claimForForward('c1', payload, store), false, 'loopback (same events) → do NOT forward');
  assert.equal(await claimForForward('c1', lineBody([{ webhookEventId: 'w2' }]), store), true, 'new event → forward');
  assert.equal(
    await claimForForward('c1', lineBody([{ webhookEventId: 'w1' }, { webhookEventId: 'w3' }]), store),
    true,
    'mixed seen+new → forward',
  );
  assert.equal(await claimForForward('c2', payload, store), true, 'per-channel isolation');
  // event-less payload → dedup on body hash (verbatim loopback still caught, any channel)
  const noEvents = lineBody([]);
  assert.equal(await claimForForward('c1', noEvents, store), true, 'first event-less sighting → forward');
  assert.equal(await claimForForward('c1', noEvents, store), false, 'event-less verbatim loopback → do NOT forward');
}

await testConfigParsing();
await testSchemaValidation();
await testSsrfGuard();
await testForwardPassesOriginalHeaders();
await testForwardBlocksSsrfTarget();
await testForwardIsBestEffortOnThrow();
await testExtractEventIds();
await testLoopGuardBreaksLoop();

console.log('downstream forwarder + loop-guard tests passed');
