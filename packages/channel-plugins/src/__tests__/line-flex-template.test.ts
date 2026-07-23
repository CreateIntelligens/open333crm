import assert from 'node:assert/strict';
import { linePlugin } from '../line/index.js';

async function testLineFlexTemplateSendsOnlyLinePayloadFields() {
  const calls: Array<{ url: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return {
      ok: true,
      json: async () => ({}),
    } as Response;
  }) as typeof fetch;

  try {
    const result = await linePlugin.sendMessage(
      'line-user-1',
      {
        contentType: 'line_flex_template',
        content: {
          type: 'flex',
          altText: 'Imported Flex',
          contents: {
            type: 'bubble',
            body: {
              type: 'box',
              layout: 'vertical',
              contents: [{ type: 'text', text: 'Hello' }],
            },
          },
          quickReplies: [{ label: 'OK', text: 'ok' }],
        },
      },
      { channelAccessToken: 'token' },
    );

    assert.equal(result.success, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.line.me/v2/bot/message/push');

    const body = calls[0].body as { messages: Array<Record<string, unknown>> };
    const message = body.messages[0];
    assert.equal(message.type, 'flex');
    assert.equal(message.altText, 'Imported Flex');
    assert.deepEqual(message.contents, {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: 'Hello' }],
      },
    });
    assert.equal('quickReplies' in message, false);
    assert.ok(message.quickReply);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testLineFlexTemplateReplyKeepsDeliveryFieldsOutOfMessage() {
  const calls: Array<{ url: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return {
      ok: true,
      json: async () => ({}),
    } as Response;
  }) as typeof fetch;

  try {
    const result = await linePlugin.sendMessage(
      'line-user-1',
      {
        contentType: 'line_flex_template',
        content: {
          type: 'flex',
          altText: 'Reply Flex',
          contents: {
            type: 'bubble',
            body: {
              type: 'box',
              layout: 'vertical',
              contents: [{ type: 'text', text: 'Reply' }],
            },
          },
          strategy: 'reply',
          replyToken: 'reply-token-1',
        },
      },
      { channelAccessToken: 'token' },
    );

    assert.equal(result.success, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.line.me/v2/bot/message/reply');

    const body = calls[0].body as { replyToken: string; messages: Array<Record<string, unknown>> };
    assert.equal(body.replyToken, 'reply-token-1');
    const message = body.messages[0];
    assert.equal(message.type, 'flex');
    assert.equal(message.altText, 'Reply Flex');
    assert.equal('strategy' in message, false);
    assert.equal('replyToken' in message, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function main() {
  await testLineFlexTemplateSendsOnlyLinePayloadFields();
  await testLineFlexTemplateReplyKeepsDeliveryFieldsOutOfMessage();
  console.log('line-flex-template channel plugin tests passed');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
