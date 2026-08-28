import assert from 'node:assert/strict';
import {
  assertSafePublicHttpUrl,
  build2mdRequestUrl,
  normalizeSearchResponse,
  readBoundedText,
} from '../modules/ai/agent/web-client.js';

assert.equal(assertSafePublicHttpUrl('https://example.com/a?x=1').hostname, 'example.com');
assert.throws(() => assertSafePublicHttpUrl('http://127.0.0.1:8080/admin'), /unsafe URL/);
assert.throws(() => assertSafePublicHttpUrl('http://169.254.169.254/latest/meta-data'), /unsafe URL/);
assert.throws(() => assertSafePublicHttpUrl('file:///etc/passwd'), /HTTP\(S\) URL/);
assert.throws(() => assertSafePublicHttpUrl('https://user:pass@example.com'), /credentials/);

assert.equal(build2mdRequestUrl('https://2md.aiurl.tw/'), 'https://2md.aiurl.tw/');
assert.equal(build2mdRequestUrl('https://2md.aiurl.tw', 'search?q=hello%20world'), 'https://2md.aiurl.tw/search?q=hello%20world');

assert.deepEqual(
  normalizeSearchResponse({
    code: 200,
    data: [{ title: 'Example', url: 'https://example.com', content: 'A result' }],
  }),
  [{ title: 'Example', url: 'https://example.com/', snippet: 'A result' }],
);

assert.deepEqual(normalizeSearchResponse('[Example](https://example.com)\nA result'), [
  { title: 'Example', url: 'https://example.com/', snippet: 'A result' },
]);

const body = new ReadableStream<Uint8Array>({
  start(controller) {
    controller.enqueue(new TextEncoder().encode('12345'));
    controller.enqueue(new TextEncoder().encode('67890'));
    controller.close();
  },
});
const result = await readBoundedText(body, 6);
assert.equal(result.text, '123456');
assert.equal(result.truncated, true);
console.log('agent-web-client tests passed');
