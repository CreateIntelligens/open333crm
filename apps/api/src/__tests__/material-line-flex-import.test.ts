import assert from 'node:assert/strict';
import {
  createMaterial,
  getMaterialForSend,
  importLineFlexMaterial,
  updateMaterial,
  validateLineFlexDraft,
} from '../modules/marketing/material.service.js';
import { encryptCredentials } from '../modules/channel/channel.service.js';

process.env.CREDENTIAL_ENCRYPTION_KEY = process.env.CREDENTIAL_ENCRYPTION_KEY || 'test-credential-encryption-key-32-bytes!!';

type StoredMaterial = Record<string, any>;

function createPrismaMock() {
  const materials = new Map<string, StoredMaterial>();
  let nextId = 1;

  return {
    materials,
    prisma: {
      messageTemplate: {
        async findUnique() {
          return null;
        },
      },
      material: {
        async create(args: { data: StoredMaterial }) {
          const item = {
            id: `mat-${nextId++}`,
            tenantId: args.data.tenantId,
            templateId: args.data.templateId ?? null,
            name: args.data.name,
            description: args.data.description ?? null,
            category: args.data.category ?? null,
            channelType: args.data.channelType,
            contentType: args.data.contentType,
            body: args.data.body,
            variables: args.data.variables ?? [],
            targetChannels: args.data.targetChannels ?? [],
            previewImageUrl: args.data.previewImageUrl ?? null,
            createdById: args.data.createdById ?? null,
            isActive: true,
            template: null,
          };
          materials.set(item.id, item);
          return item;
        },
        async findUnique(args: { where: { id: string } }) {
          return materials.get(args.where.id) ?? null;
        },
        async update(args: { where: { id: string }; data: StoredMaterial }) {
          const current = materials.get(args.where.id);
          if (!current) throw new Error('missing material');
          const next = { ...current, ...args.data };
          materials.set(args.where.id, next);
          return next;
        },
      },
      channel: {
        async findFirst() {
          return {
            credentialsEncrypted: encryptCredentials({ channelAccessToken: 'line-token' }),
          };
        },
      },
    },
  };
}

const bubble = {
  type: 'bubble',
  body: {
    type: 'box',
    layout: 'vertical',
    contents: [
      { type: 'text', text: 'Brown Cafe', weight: 'bold' },
      {
        type: 'button',
        action: { type: 'uri', label: 'Open', uri: 'https://example.com' },
      },
    ],
  },
};

async function testImportCompleteAndRawFlexPayloads() {
  const { prisma } = createPrismaMock();
  const complete = await importLineFlexMaterial(prisma as any, 'tenant-1', {
    name: 'Sale',
    payload: { type: 'flex', altText: 'Sale', contents: bubble },
    createdById: 'agent-1',
  });

  assert.equal(complete.channelType, 'line');
  assert.equal(complete.contentType, 'line_flex_template');
  assert.equal((complete.body as any).type, 'flex');
  assert.equal((complete.body as any).altText, 'Sale');
  assert.equal((complete.body as any).contents.type, 'bubble');
  assert.equal('editableContainers' in (complete.body as any), false);
  assert.equal('fields' in (complete.body as any), false);
  assert.deepEqual(complete.variables, []);

  const raw = await importLineFlexMaterial(prisma as any, 'tenant-1', {
    name: 'Raw Flex',
    payload: { type: 'carousel', contents: [bubble] },
  });
  assert.equal((raw.body as any).altText, 'Raw Flex');
  assert.equal((raw.body as any).contents.type, 'carousel');
  assert.equal((raw.body as any).type, 'flex');
}

async function testValidateRejectsInvalidRoot() {
  const { prisma } = createPrismaMock();
  await assert.rejects(
    () => validateLineFlexDraft(prisma as any, 'tenant-1', { type: 'text', text: 'hello' }),
    (error: any) => error.code === 'INVALID_LINE_FLEX_PAYLOAD',
  );
}

async function testValidateCallsLineValidateApi() {
  const { prisma } = createPrismaMock();
  const calls: Array<{ url: string; headers?: HeadersInit; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: init?.headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return {
      ok: true,
      json: async () => ({}),
    } as Response;
  }) as typeof fetch;

  try {
    const result = await validateLineFlexDraft(
      prisma as any,
      'tenant-1',
      { type: 'flex', altText: 'Sale', contents: bubble },
    );

    assert.equal(result.validation.valid, true);
    assert.equal(result.body.type, 'flex');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.line.me/v2/bot/message/validate/reply');
    assert.deepEqual(calls[0].headers, {
      Authorization: 'Bearer line-token',
      'Content-Type': 'application/json',
    });
    assert.deepEqual(calls[0].body, {
      messages: [
        {
          type: 'flex',
          altText: 'Sale',
          contents: bubble,
        },
      ],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testValidateSurfacesLineApiErrors() {
  const { prisma } = createPrismaMock();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: false,
    status: 400,
    json: async () => ({
      message: 'The request body has 1 error(s)',
      details: [
        {
          property: 'messages[0].contents.body.contents[0].text',
          message: 'must not be empty',
        },
      ],
    }),
  })) as typeof fetch;

  try {
    await assert.rejects(
      () => validateLineFlexDraft(prisma as any, 'tenant-1', { type: 'flex', altText: 'Sale', contents: bubble }),
      (error: any) => {
        assert.equal(error.code, 'LINE_FLEX_VALIDATE_FAILED');
        assert.match(error.message, /The request body has 1 error/);
        assert.match(error.message, /messages\[0\]\.contents\.body\.contents\[0\]\.text: must not be empty/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testCreateAndUpdateNormalizePureFlexPayload() {
  const { prisma } = createPrismaMock();
  const created = await createMaterial(prisma as any, 'tenant-1', {
    name: 'Created Raw',
    channelType: 'line',
    contentType: 'line_flex_template',
    body: bubble,
    variables: [{ key: 'legacy', required: true }],
  });
  assert.equal((created.body as any).type, 'flex');
  assert.equal((created.body as any).contents.type, 'bubble');
  assert.deepEqual(created.variables, []);

  const updated = await updateMaterial(prisma as any, created.id, 'tenant-1', {
    body: {
      altText: 'Legacy Normalized',
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [{ type: 'text', text: 'Updated' }],
        },
      },
      fields: [{ key: 'should_drop' }],
      editableContainers: [{ path: '/body/contents' }],
    },
  });
  assert.deepEqual(updated.body, {
    type: 'flex',
    altText: 'Legacy Normalized',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: 'Updated' }],
      },
    },
  });
  assert.deepEqual(updated.variables, []);
}

async function testSendHelperReturnsPureFlexBody() {
  const { prisma } = createPrismaMock();
  const material = await importLineFlexMaterial(prisma as any, 'tenant-1', {
    name: 'Cafe',
    payload: bubble,
  });
  const result = await getMaterialForSend(prisma as any, material.id, 'tenant-1');
  assert.equal(result.contentType, 'line_flex_template');
  assert.deepEqual(result.renderedBody, material.body);
}

await testImportCompleteAndRawFlexPayloads();
await testValidateRejectsInvalidRoot();
await testValidateCallsLineValidateApi();
await testValidateSurfacesLineApiErrors();
await testCreateAndUpdateNormalizePureFlexPayload();
await testSendHelperReturnsPureFlexBody();

console.log('material-line-flex-import tests passed');
