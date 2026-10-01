import assert from 'node:assert/strict';
import { test } from 'vitest';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import webchatRoutes from '#src/modules/webchat/webchat.routes.js';

test('webchat-security', async () => {
  const channelId = '11111111-1111-4111-8111-111111111111';

  async function createApp() {
    const app = Fastify();
    await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
    await app.register(webchatRoutes, { prefix: '/webchat' });
    return app;
  }

  const app = await createApp();

  const oldSession = await app.inject({
    method: 'POST',
    url: `/webchat/${channelId}/sessions`,
    payload: { visitorToken: '22222222-2222-4222-8222-222222222222' },
  });
  assert.equal(oldSession.statusCode, 410);
  assert.match(oldSession.body, /WEBCHAT_LEGACY_ROUTE_RETIRED/);

  const oldMessage = await app.inject({
    method: 'POST',
    url: `/webchat/${channelId}/messages`,
    payload: {
      visitorToken: '33333333-3333-4333-8333-333333333333',
      contentType: 'text',
      content: { text: 'attacker-controlled visitor token' },
    },
  });
  assert.equal(oldMessage.statusCode, 400);
  assert.equal(oldMessage.body.includes('visitorToken'), false);

  await app.close();
});
