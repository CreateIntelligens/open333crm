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

// review-loop 第 2 輪：結尾逗號或斷行的 register 原本不符合 regex，子路由被靜默略過
describe('子 plugin 的註冊寫法', () => {
  const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src');
  const apiSource = `
    import settingsRoutes from './modules/settings/settings.routes.js';
    await app.register(settingsRoutes, { prefix: '/api/v1/settings' });
  `;
  const child = (file, path) => [resolve(sourceRoot, `modules/settings/${file}`), `fastify.get("${path}", async () => ({}));`];

  it('結尾逗號與斷行的 register 也讀得到', () => {
    const routeSources = new Map([
      [resolve(sourceRoot, 'modules/settings/settings.routes.ts'), `
        import aRoutes from "./a.routes.js";
        import bRoutes from "./b.routes.js";
        import cRoutes from "./c.routes.js";
        await fastify.register(aRoutes,);
        await fastify.register(bRoutes, {},);
        await fastify.register(
          cRoutes,
          { prefix: "/c" },
        );
      `],
      child('a.routes.ts', '/a'),
      child('b.routes.ts', '/b'),
      child('c.routes.ts', '/x'),
    ]);
    const document = buildOpenApiDocument(collectOpenApiRoutes(apiSource, routeSources));
    assert.ok(document.paths['/api/v1/settings/a']?.get);
    assert.ok(document.paths['/api/v1/settings/b']?.get);
    assert.ok(document.paths['/api/v1/settings/c/x']?.get);
  });

  // review-loop 第 3 輪：options 是變數時原本只比對變數名稱，前綴被當成空字串
  it('options 是同一個檔案定義的變數時，讀它的前綴與驗證', () => {
    const routeSources = new Map([
      [resolve(sourceRoot, 'modules/settings/settings.routes.ts'), `
        import aRoutes from "./a.routes.js";
        const nested = { prefix: "/nested" };
        const guard = { preHandler: [fastify.authenticate] };
        await fastify.register(aRoutes, nested);
        await fastify.register(aRoutes, guard);
      `],
      child('a.routes.ts', '/x'),
    ]);
    const document = buildOpenApiDocument(collectOpenApiRoutes(apiSource, routeSources));
    assert.ok(document.paths['/api/v1/settings/nested/x']?.get, '前綴取自變數的定義');
    assert.equal(Object.hasOwn(document.paths['/api/v1/settings/nested/x'].get, 'security'), false);
    assert.deepEqual(document.paths['/api/v1/settings/x']?.get?.security, [{ BearerAuth: [] }], 'guard 變數含驗證');
  });

  for (const [label, register] of [
    ['變數不是在這個檔案以物件字面值定義', 'await fastify.register(aRoutes, importedOptions);'],
    ['options 有展開運算子', 'await fastify.register(aRoutes, { ...base, prefix: "/a" });'],
    ['prefix 不是字串字面值', 'await fastify.register(aRoutes, { prefix: PREFIX });'],
  ]) {
    it(`${label}時丟出錯誤`, () => {
      const routeSources = new Map([
        [resolve(sourceRoot, 'modules/settings/settings.routes.ts'), `
          import aRoutes from "./a.routes.js";
          ${register}
        `],
        child('a.routes.ts', '/a'),
      ]);
      assert.throws(() => collectOpenApiRoutes(apiSource, routeSources), /aRoutes/);
    });
  }

  it('解析不出來的註冊丟出錯誤，不靜默略過', () => {
    const routeSources = new Map([
      [resolve(sourceRoot, 'modules/settings/settings.routes.ts'), `
        import aRoutes from "./a.routes.js";
        await fastify.register(aRoutes, buildOptions("/a"));
      `],
      child('a.routes.ts', '/a'),
    ]);
    assert.throws(() => collectOpenApiRoutes(apiSource, routeSources), /aRoutes/);
  });
});
