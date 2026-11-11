import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';

const { createMaterial, updateMaterial } = await import('#src/modules/marketing/material.service.js');

const tenantId = 'a0000000-0000-4000-8000-000000000001';
const originalBody = { text: '客人電話 0912345678，信箱 qa@example.com' };
const maskedBody = { text: '客人電話 〈電話〉，信箱 〈電子郵件〉' };
let enabled = true;
let failMasking = false;
let maskCalls = 0;

function fakeDb() {
  const createWrites: Array<Record<string, unknown>> = [];
  const updateWrites: Array<Record<string, unknown>> = [];
  const versionWrites: Array<Record<string, unknown>> = [];
  const existing = {
    id: 'material-1', tenantId, name: '測試素材', description: null, category: null, categoryId: null,
    tags: [], status: 'draft', channelType: 'line', contentType: 'line_text', body: originalBody,
    maskedBody: null, privacyMode: null, variables: [], targetChannels: [], previewImageUrl: null,
    isActive: true, usageCount: 0, lastUsedAt: null, createdById: null,
  };
  const db = {
    platformSetting: {
      findUnique: async () => enabled ? { value: { enabled: true } } : null,
    },
    channel: { findFirst: async () => null },
    material: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createWrites.push(data);
        return { ...existing, ...data };
      },
      findUnique: async () => existing,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updateWrites.push(data);
        return { ...existing, ...data };
      },
    },
    materialVersion: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        versionWrites.push(data);
        return data;
      },
    },
  };
  return { db: db as never, createWrites, updateWrites, versionWrites };
}

beforeEach(() => {
  enabled = true;
  failMasking = false;
  maskCalls = 0;
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes('/api/deid')) {
      maskCalls += 1;
      if (failMasking) return new Response('unavailable', { status: 503 });
      const submitted = JSON.parse(String(init?.body)).text as string;
      const text = submitted
        .replace('0912345678', '〈電話〉')
        .replace('qa@example.com', '〈電子郵件〉');
      return new Response(JSON.stringify({ code: 200, data: { status: 'ok', text } }));
    }
    throw new Error(`Unexpected network request: ${String(url)}`);
  });
});

test('enabled material masks nested text fields as well as the main message text', async () => {
  const nested = {
    text: '客人電話 0912345678',
    button: { label: '寄信給 qa@example.com', postbackData: '聯絡電話 0912345678' },
    link: { url: 'https://example.invalid/contact?email=qa@example.com' },
  };
  const { db, createWrites } = fakeDb();
  await createMaterial(db, tenantId, {
    name: '巢狀文字', channelType: 'line', contentType: 'line_text', body: nested,
  });

  assert.deepEqual(createWrites[0].body, {
    text: '客人電話 〈電話〉',
    button: { label: '寄信給 〈電子郵件〉', postbackData: '聯絡電話 〈電話〉' },
    link: { url: 'https://example.invalid/contact?email=〈電子郵件〉' },
  });
  assert.deepEqual(createWrites[0].maskedBody, createWrites[0].body);
  assert.equal(maskCalls, 4);
});

afterEach(() => vi.unstubAllGlobals());

test('enabled material creation stores masked body and masked initial version by default', async () => {
  const { db, createWrites, versionWrites } = fakeDb();
  await createMaterial(db, tenantId, {
    name: '測試素材', channelType: 'line', contentType: 'line_text', body: originalBody,
  });

  assert.deepEqual(createWrites[0].body, maskedBody);
  assert.deepEqual(createWrites[0].maskedBody, maskedBody);
  assert.equal(createWrites[0].privacyMode, 'mask');
  assert.deepEqual(versionWrites[0].body, maskedBody);
  assert.deepEqual(versionWrites[0].maskedBody, maskedBody);
  assert.equal(versionWrites[0].privacyMode, 'mask');
  assert.equal(maskCalls, 1);
});

test('enabled material creation can retain authored body while saving a masked version', async () => {
  const { db, createWrites, versionWrites } = fakeDb();
  await createMaterial(db, tenantId, {
    name: '測試素材', channelType: 'line', contentType: 'line_text', body: originalBody, privacyMode: 'original',
  });

  assert.deepEqual(createWrites[0].body, originalBody);
  assert.deepEqual(createWrites[0].maskedBody, maskedBody);
  assert.equal(createWrites[0].privacyMode, 'original');
  assert.deepEqual(versionWrites[0].body, originalBody);
  assert.deepEqual(versionWrites[0].maskedBody, maskedBody);
  assert.equal(versionWrites[0].privacyMode, 'original');
});

test('enabled material update refreshes masked body and version snapshot by default', async () => {
  const { db, updateWrites, versionWrites } = fakeDb();
  await updateMaterial(db, 'material-1', tenantId, { body: originalBody });

  assert.deepEqual(updateWrites[0].body, maskedBody);
  assert.deepEqual(updateWrites[0].maskedBody, maskedBody);
  assert.equal(updateWrites[0].privacyMode, 'mask');
  assert.deepEqual(versionWrites[0].body, maskedBody);
  assert.deepEqual(versionWrites[0].maskedBody, maskedBody);
  assert.equal(versionWrites[0].privacyMode, 'mask');
});

test('enabled material update can explicitly keep original body with protected version snapshot', async () => {
  const { db, updateWrites, versionWrites } = fakeDb();
  await updateMaterial(db, 'material-1', tenantId, { body: originalBody, privacyMode: 'original' });

  assert.deepEqual(updateWrites[0].body, originalBody);
  assert.deepEqual(updateWrites[0].maskedBody, maskedBody);
  assert.equal(updateWrites[0].privacyMode, 'original');
  assert.deepEqual(versionWrites[0].body, originalBody);
  assert.deepEqual(versionWrites[0].maskedBody, maskedBody);
  assert.equal(versionWrites[0].privacyMode, 'original');
});

test('material write does not persist when de-identification fails', async () => {
  failMasking = true;
  const { db, createWrites, versionWrites } = fakeDb();

  await assert.rejects(
    createMaterial(db, tenantId, {
      name: '測試素材', channelType: 'line', contentType: 'line_text', body: originalBody,
    }),
    (error: { code?: string }) => error.code === 'AI_DEIDENTIFICATION_UNAVAILABLE',
  );
  assert.equal(createWrites.length, 0);
  assert.equal(versionWrites.length, 0);
});

test('material update does not write a body or version when de-identification fails', async () => {
  failMasking = true;
  const { db, updateWrites, versionWrites } = fakeDb();

  await assert.rejects(
    updateMaterial(db, 'material-1', tenantId, { body: originalBody }),
    (error: { code?: string }) => error.code === 'AI_DEIDENTIFICATION_UNAVAILABLE',
  );
  assert.equal(updateWrites.length, 0);
  assert.equal(versionWrites.length, 0);
});

test('disabled policy saves material body unchanged without a privacy sidecar', async () => {
  enabled = false;
  const { db, createWrites, versionWrites } = fakeDb();
  await createMaterial(db, tenantId, {
    name: '測試素材', channelType: 'line', contentType: 'line_text', body: originalBody,
  });

  assert.deepEqual(createWrites[0].body, originalBody);
  assert.equal(createWrites[0].maskedBody, undefined);
  assert.equal(createWrites[0].privacyMode, null);
  assert.equal(versionWrites[0].maskedBody, undefined);
  assert.equal(maskCalls, 0);
});
