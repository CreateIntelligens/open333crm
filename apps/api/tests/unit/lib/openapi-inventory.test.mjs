import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument, collectOpenApiRoutes } from '../../../src/lib/openapi-inventory.mjs';

describe('OpenAPI execution metadata', () => {
  it('uses the current origin and adds authorization and generic JSON bodies to protected writes', () => {
    const apiSource = `
      import caseRoutes from './modules/case/case.routes.js';
      import webhookRoutes from './modules/webhook/webhook.routes.js';
      await app.register(caseRoutes, { prefix: '/api/v1/cases' });
      await app.register(webhookRoutes, { prefix: '/api/v1/webhooks' });
    `;
    const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src');
    const routeSources = new Map([
      [resolve(sourceRoot, 'modules/case/case.routes.ts'), `
        fastify.addHook('preHandler', fastify.authenticate);
        fastify.post('/', async () => ({}));
        fastify.get('/:id', async () => ({}));
      `],
      [resolve(sourceRoot, 'modules/webhook/webhook.routes.ts'), `
        fastify.post('/line/:channelId', async () => ({}));
      `],
    ]);

    const document = buildOpenApiDocument(collectOpenApiRoutes(apiSource, routeSources));
    const protectedCreate = document.paths['/api/v1/cases'].post;
    const protectedRead = document.paths['/api/v1/cases/{id}'].get;
    const publicWebhook = document.paths['/api/v1/webhooks/line/{channelId}'].post;

    assert.equal(document.servers[0].url, '/');
    assert.equal(protectedCreate.security[0].BearerAuth.length, 0);
    assert.equal(protectedCreate.requestBody.content['application/json'].schema.additionalProperties, true);
    assert.equal(protectedRead.security[0].BearerAuth.length, 0);
    assert.equal(Object.hasOwn(publicWebhook, 'security'), false);
  });
});
