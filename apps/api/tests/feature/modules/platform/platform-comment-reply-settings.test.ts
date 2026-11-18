/**
 * 留言自動私訊的平台設定鍵有型別檢查（change add-comment-keyword-private-reply tasks 9.1，design D21；
 * spec comment-reply-platform-controls「平台設定鍵有型別檢查」）。
 *
 * 走真實的 platform.routes（PUT /settings/:key）、setPlatformSetting、writePlatformAudit 與測試資料庫。
 * 平台認證換成固定的平台帳號。每個測試前把 5 個鍵還原成「沒有設定」，afterAll 刪除並清掉平台帳號與稽核。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, describe, test } from 'vitest';
import Fastify from 'fastify';
import { Redis } from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import platformRoutes from '#src/modules/platform/platform.routes.js';
import {
  clearCommentReplyPlatformSettingsCache,
  COMMENT_REPLY_SETTING_KEYS,
  readCommentReplyPlatformSettings,
} from '#src/modules/comment-reply/comment-reply-platform-settings.js';

loadEnvConfig();

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL!);
const stamp = `cr-settings-${Date.now()}`;
const KEYS = Object.values(COMMENT_REPLY_SETTING_KEYS);

const platformUser = await prisma.platformUser.create({
  data: { email: `${stamp}@example.test`, name: 'CI 留言私訊平台設定', passwordHash: 'x' },
});

const app = Fastify();
app.decorate('prismaAdmin', prisma as never);
app.decorate('redis', redis as never);
app.decorateRequest('platformUser', null);
app.decorate('authenticatePlatformSuperuser', async (req: { platformUser: unknown }) => {
  req.platformUser = { id: platformUser.id, role: 'PLATFORM_SUPERUSER', mustChangePassword: false };
});
await app.register(errorHandlerPlugin);
await app.register(platformRoutes, { prefix: '/api/v1/platform' });
await app.ready();

beforeEach(async () => {
  await prisma.platformSetting.deleteMany({ where: { key: { in: KEYS } } });
  clearCommentReplyPlatformSettingsCache();
});

afterAll(async () => {
  await app.close();
  await prisma.platformSetting.deleteMany({ where: { key: { in: KEYS } } });
  await prisma.platformAuditLog.deleteMany({ where: { platformUserId: platformUser.id } });
  await prisma.platformUser.delete({ where: { id: platformUser.id } });
  await redis.quit();
  await prisma.$disconnect();
});

const put = (key: string, value: unknown) =>
  app.inject({ method: 'PUT', url: `/api/v1/platform/settings/${key}`, payload: { value } });
const stored = async (key: string) => (await prisma.platformSetting.findUnique({ where: { key } }))?.value ?? null;

const CAPS = { fbPrivateReply: true, fbPostPicker: false, fbPublicReply: false, igPrivateReply: false, igPostPicker: false, igPublicReply: false };

test('寫入合法的能力開關：200，平台稽核有一筆 setting.update', async () => {
  const res = await put(COMMENT_REPLY_SETTING_KEYS.capabilities, CAPS);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(await stored(COMMENT_REPLY_SETTING_KEYS.capabilities), CAPS);
  const audits = await prisma.platformAuditLog.findMany({
    where: { platformUserId: platformUser.id, action: 'setting.update', targetId: COMMENT_REPLY_SETTING_KEYS.capabilities },
  });
  assert.equal(audits.length, 1);
});

test('寫入不合法的值：保存天數 5 → 400，設定不變', async () => {
  await put(COMMENT_REPLY_SETTING_KEYS.logRetentionDays, 90);
  const res = await put(COMMENT_REPLY_SETTING_KEYS.logRetentionDays, 5);
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'VALIDATION_ERROR');
  assert.equal(await stored(COMMENT_REPLY_SETTING_KEYS.logRetentionDays), 90);
});

test('寫入不合法的值：能力開關少一個欄位 → 400，沒有寫入', async () => {
  const { igPublicReply: _drop, ...missing } = CAPS;
  const res = await put(COMMENT_REPLY_SETTING_KEYS.capabilities, missing);
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(await stored(COMMENT_REPLY_SETTING_KEYS.capabilities), null);
});

describe('5 個鍵各一組合法與不合法值', () => {
  const cases: Array<{ key: string; valid: unknown; invalid: unknown[] }> = [
    { key: COMMENT_REPLY_SETTING_KEYS.capabilities, valid: CAPS, invalid: [{ ...CAPS, fbPrivateReply: 'yes' }, { ...CAPS, extra: true }, null] },
    { key: COMMENT_REPLY_SETTING_KEYS.testPhase, valid: { fb: false, ig: true }, invalid: [{ fb: false }, { fb: 1, ig: true }] },
    {
      key: COMMENT_REPLY_SETTING_KEYS.emergencyStop,
      valid: { stopped: true, reason: '垃圾訊息警告' },
      invalid: [{ reason: '缺 stopped' }, { stopped: true, reason: 'x'.repeat(201) }],
    },
    {
      key: COMMENT_REPLY_SETTING_KEYS.rateLimits,
      valid: { fbPerHour: 1, igPerHour: 30000, publicReplyPerHour: 300 },
      invalid: [{ fbPerHour: 0, igPerHour: 700, publicReplyPerHour: 300 }, { fbPerHour: 700, igPerHour: 30001, publicReplyPerHour: 300 }, { fbPerHour: 1.5, igPerHour: 700, publicReplyPerHour: 300 }],
    },
    { key: COMMENT_REPLY_SETTING_KEYS.logRetentionDays, valid: 730, invalid: [29, 731, '180', 100.5] },
  ];

  for (const c of cases) {
    test(`${c.key}：合法值 200 並讀回，不合法值 400 不寫入`, async () => {
      for (const bad of c.invalid) {
        const res = await put(c.key, bad);
        assert.equal(res.statusCode, 400, `${JSON.stringify(bad)} 應回 400：${res.body}`);
        assert.equal(await stored(c.key), null, `${JSON.stringify(bad)} 不應寫入`);
      }
      const ok = await put(c.key, c.valid);
      assert.equal(ok.statusCode, 200, ok.body);
      assert.deepEqual(await stored(c.key), c.valid);
    });
  }
});

test('沒有設定時的預設：能力全關、測試階段開、未緊急停止、700／700／300、180 天', async () => {
  const s = await readCommentReplyPlatformSettings(prisma, { fresh: true });
  assert.ok(Object.values(s.capabilities).every((v) => v === false));
  assert.deepEqual(s.testPhase, { fb: true, ig: true });
  assert.equal(s.emergencyStop.stopped, false);
  assert.deepEqual(s.rateLimits, { fbPerHour: 700, igPerHour: 700, publicReplyPerHour: 300 });
  assert.equal(s.logRetentionDays, 180);
});

test('寫入後同一行程立即讀到新值（路由清掉 60 秒快取）', async () => {
  await readCommentReplyPlatformSettings(prisma); // 先把預設值放進快取
  const res = await put(COMMENT_REPLY_SETTING_KEYS.emergencyStop, { stopped: true });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal((await readCommentReplyPlatformSettings(prisma)).emergencyStop.stopped, true);
});
