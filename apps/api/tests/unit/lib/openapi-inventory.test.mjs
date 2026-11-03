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

describe('路由檔內註冊的子 plugin', () => {
  const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src');
  const apiSource = `
    import settingsRoutes from './modules/settings/settings.routes.js';
    import platformRoutes from './modules/platform/platform.routes.js';
    await app.register(settingsRoutes, { prefix: '/api/v1/settings' });
    await app.register(platformRoutes, { prefix: '/api/v1/platform' });
  `;
  const routeSources = new Map([
    [resolve(sourceRoot, 'modules/settings/settings.routes.ts'), `
      import officeHoursRoutes from "./office-hours.routes.js";
      import nestedRoutes from "../other/nested.routes.js";
      fastify.addHook("preHandler", fastify.authenticate);
      fastify.get("/a2a", async () => ({}));
      await fastify.register(officeHoursRoutes);
      await fastify.register(nestedRoutes, { prefix: "/nested" });
    `],
    [resolve(sourceRoot, 'modules/settings/office-hours.routes.ts'), `
      fastify.get("/office-hours", async () => ({}));
      fastify.put("/office-hours", async () => ({}));
    `],
    [resolve(sourceRoot, 'modules/other/nested.routes.ts'), `
      fastify.get("/:id", async () => ({}));
    `],
    [resolve(sourceRoot, 'modules/platform/platform.routes.ts'), `
      import aiPrivacyRoutes from './ai-privacy.routes.js';
      import publicRoutes from './public.routes.js';
      const guard = { preHandler: [fastify.authenticatePlatformSuperuser, blockIfMustChangePassword] };
      await fastify.register(aiPrivacyRoutes, guard);
      await fastify.register(publicRoutes);
    `],
    [resolve(sourceRoot, 'modules/platform/ai-privacy.routes.ts'), `
      const guard = { preHandler: options.preHandler };
      fastify.get('/tenants/:id/ai-privacy', guard, async () => ({}));
    `],
    [resolve(sourceRoot, 'modules/platform/public.routes.ts'), `
      fastify.get('/status', async () => ({}));
    `],
  ]);
  const document = buildOpenApiDocument(collectOpenApiRoutes(apiSource, routeSources));

  it('子 plugin 的路由沿用外層的前綴，並以所在的檔案標示來源', () => {
    assert.ok(document.paths['/api/v1/settings/a2a']?.get);
    assert.ok(document.paths['/api/v1/settings/office-hours']?.get);
    assert.ok(document.paths['/api/v1/settings/office-hours']?.put);
    assert.match(document.paths['/api/v1/settings/office-hours']?.get?.description ?? '', /modules\/settings\/office-hours\.routes\.ts/);
  });

  it('註冊時指定的 prefix 接在外層的前綴後面，import 的路徑以所在的檔案解析', () => {
    assert.ok(document.paths['/api/v1/settings/nested/{id}']?.get);
  });

  it('外層以 addHook 驗證登入時，子 plugin 的路由也標示需要登入', () => {
    assert.deepEqual(document.paths['/api/v1/settings/office-hours']?.get?.security, [{ BearerAuth: [] }]);
    assert.deepEqual(document.paths['/api/v1/settings/nested/{id}']?.get?.security, [{ BearerAuth: [] }]);
  });

  it('以帶有驗證的 options 註冊時，子 plugin 的路由標示需要登入；沒有驗證時不標示', () => {
    assert.deepEqual(document.paths['/api/v1/platform/tenants/{id}/ai-privacy']?.get?.security, [{ BearerAuth: [] }]);
    assert.ok(document.paths['/api/v1/platform/status']?.get);
    assert.equal(Object.hasOwn(document.paths['/api/v1/platform/status'].get, 'security'), false);
  });
});
