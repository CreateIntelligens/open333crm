/**
 * WebTalk 租戶房間與設定（change webtalk-multi-tenant，spec webtalk-collaboration）。
 * service 層：房間代號推導、fail-closed 設定解析、租戶設定預設值與 session 組裝。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  buildWebTalkSession,
  deriveWebTalkRoomId,
  getWebTalkSettings,
  resolveWebTalkServerConfig,
  rotateWebTalkRoom,
  updateWebTalkSettings,
  type WebTalkServerConfig,
} from '#src/modules/webtalk/webtalk.service.js';

const TENANT_A = 'a0000000-0000-0000-0000-000000000001';
const TENANT_B = 'b0000000-0000-0000-0000-000000000002';
const SECRET = 'x'.repeat(48);

const ENV = {
  WEBTALK_ROOM_SECRET: SECRET,
  WEBTALK_SITE_ID: 'open333crm-test',
  WEBTALK_SDK_URL: 'https://sdk.example.test/webtalk.js',
  WEBTALK_SDK_INTEGRITY: undefined,
  WEBTALK_AI_ENDPOINT: undefined,
};

/** 只實作 service 會呼叫的 tenantSettings 方法；rows 以 tenantId 為 key。 */
function mockDb(rows: Record<string, Record<string, unknown>> = {}) {
  const calls: Array<{ method: string; args: any }> = [];
  const db = {
    tenantSettings: {
      async findUnique(args: any) {
        calls.push({ method: 'findUnique', args });
        return rows[args.where.tenantId] ?? null;
      },
      async upsert(args: any) {
        calls.push({ method: 'upsert', args });
        const tenantId = args.where.tenantId;
        const current = rows[tenantId];
        const next: Record<string, unknown> = current
          ? { ...current }
          : { webtalkEnabled: true, webtalkAiEnabled: false, webtalkRoomVersion: 0, ...args.create };
        if (current) {
          for (const [k, v] of Object.entries(args.update)) {
            next[k] = typeof v === 'object' && v !== null && 'increment' in (v as object)
              ? (Number(current[k] ?? 0) + (v as { increment: number }).increment)
              : v;
          }
        }
        rows[tenantId] = next;
        return next;
      },
    },
  };
  return { db: db as never, calls, rows };
}

const config = (over: Partial<WebTalkServerConfig> = {}): WebTalkServerConfig => ({
  ...(resolveWebTalkServerConfig(ENV) as WebTalkServerConfig),
  ...over,
});

// ── 房間代號 ──

test('Agents of the same tenant share one room', () => {
  assert.equal(
    deriveWebTalkRoomId(SECRET, 'open333crm-test', TENANT_A, 0),
    deriveWebTalkRoomId(SECRET, 'open333crm-test', TENANT_A, 0),
  );
});

test('Different tenants never share a room', () => {
  const a = deriveWebTalkRoomId(SECRET, 'open333crm-test', TENANT_A, 0);
  const b = deriveWebTalkRoomId(SECRET, 'open333crm-test', TENANT_B, 0);
  assert.notEqual(a, b);
  for (const id of [a, b]) {
    assert.match(id, /^o333-[A-Za-z0-9_-]{43}$/);
    assert.ok(!id.includes(TENANT_A) && !id.includes(TENANT_B), '不含租戶 ID 原文');
  }
});

test('Environments do not share rooms', () => {
  assert.notEqual(
    deriveWebTalkRoomId(SECRET, 'open333crm-uat', TENANT_A, 0),
    deriveWebTalkRoomId(SECRET, 'open333crm-prod', TENANT_A, 0),
  );
});

test('不同密鑰產生不同房間（換密鑰即作廢全部房間）', () => {
  assert.notEqual(
    deriveWebTalkRoomId(SECRET, 'open333crm-test', TENANT_A, 0),
    deriveWebTalkRoomId('y'.repeat(48), 'open333crm-test', TENANT_A, 0),
  );
});

test('Rotation changes the room ID（房間版本不同即不同房）', () => {
  assert.notEqual(
    deriveWebTalkRoomId(SECRET, 'open333crm-test', TENANT_A, 0),
    deriveWebTalkRoomId(SECRET, 'open333crm-test', TENANT_A, 1),
  );
});

// ── 伺服器設定 fail-closed ──

test('Missing room secret fails closed', () => {
  assert.equal(resolveWebTalkServerConfig({ ...ENV, WEBTALK_ROOM_SECRET: undefined }), null);
  assert.equal(resolveWebTalkServerConfig({ ...ENV, WEBTALK_ROOM_SECRET: 'short-secret' }), null, '少於 32 字元');
  assert.equal(resolveWebTalkServerConfig({ ...ENV, WEBTALK_SDK_URL: undefined }), null);
  assert.equal(resolveWebTalkServerConfig({ ...ENV, WEBTALK_SDK_URL: 'http://sdk.example.test/webtalk.js' }), null, '非 https');
  assert.equal(resolveWebTalkServerConfig({ ...ENV, WEBTALK_SDK_URL: 'not a url' }), null);
});

test('完整設定時解析成功；localhost 可用 http；AI 端點格式錯誤時視為未設定', () => {
  const resolved = resolveWebTalkServerConfig({
    ...ENV,
    WEBTALK_SDK_URL: 'http://localhost:4000/webtalk.js',
    WEBTALK_SDK_INTEGRITY: ' sha384-abc ',
    WEBTALK_AI_ENDPOINT: 'http://evil.example.test/ai',
  });
  assert.ok(resolved);
  assert.equal(resolved.sdkUrl, 'http://localhost:4000/webtalk.js');
  assert.equal(resolved.sdkIntegrity, 'sha384-abc');
  assert.equal(resolved.aiEndpoint, null);
  assert.equal(resolved.siteId, 'open333crm-test');
});

// ── 租戶設定 ──

test('Defaults without a settings row', async () => {
  const { db } = mockDb();
  assert.deepEqual(await getWebTalkSettings(db, TENANT_A), { enabled: true, aiEnabled: false, roomVersion: 0 });
});

test('updateWebTalkSettings 只寫自己租戶、只寫有送的欄位', async () => {
  const { db, calls, rows } = mockDb();
  const result = await updateWebTalkSettings(db, TENANT_A, { aiEnabled: true });
  assert.deepEqual(result, { enabled: true, aiEnabled: true });
  const upsert = calls.find((c) => c.method === 'upsert')!;
  assert.equal(upsert.args.where.tenantId, TENANT_A);
  assert.deepEqual(upsert.args.update, { webtalkAiEnabled: true });
  assert.equal(rows[TENANT_B], undefined);
});

test('rotateWebTalkRoom 讓房間版本加一', async () => {
  const { db, rows } = mockDb({ [TENANT_A]: { webtalkEnabled: true, webtalkAiEnabled: false, webtalkRoomVersion: 2 } });
  await rotateWebTalkRoom(db, TENANT_A);
  assert.equal(rows[TENANT_A].webtalkRoomVersion, 3);
});

// ── session 組裝 ──

test('伺服器未設定時 session 為 NOT_CONFIGURED，且不查資料庫', async () => {
  const { db, calls } = mockDb();
  assert.deepEqual(await buildWebTalkSession(db, TENANT_A, null), { enabled: false, reason: 'NOT_CONFIGURED' });
  assert.equal(calls.length, 0);
});

test('Tenant disables WebTalk（session 為 TENANT_DISABLED，不含 roomId）', async () => {
  const { db } = mockDb({ [TENANT_A]: { webtalkEnabled: false, webtalkAiEnabled: true, webtalkRoomVersion: 0 } });
  const session = await buildWebTalkSession(db, TENANT_A, config());
  assert.deepEqual(session, { enabled: false, reason: 'TENANT_DISABLED' });
});

test('AI summary disabled by default', async () => {
  const { db } = mockDb();
  const session = await buildWebTalkSession(db, TENANT_A, config({ aiEndpoint: 'https://ai.example.test/api/webtalk/ai' }));
  assert.equal(session.enabled, true);
  if (!session.enabled) return;
  assert.equal(session.roomId, deriveWebTalkRoomId(SECRET, 'open333crm-test', TENANT_A, 0));
  assert.equal(session.sdkUrl, 'https://sdk.example.test/webtalk.js');
  assert.equal(session.sdkIntegrity, null);
  assert.equal(session.aiEnabled, false);
  assert.equal(session.aiEndpoint, null);
});

test('AI summary enabled by the tenant', async () => {
  const { db } = mockDb({ [TENANT_A]: { webtalkEnabled: true, webtalkAiEnabled: true, webtalkRoomVersion: 0 } });
  const session = await buildWebTalkSession(db, TENANT_A, config({ aiEndpoint: 'https://ai.example.test/api/webtalk/ai' }));
  assert.ok(session.enabled);
  assert.equal(session.aiEnabled, true);
  assert.equal(session.aiEndpoint, 'https://ai.example.test/api/webtalk/ai');
});

test('AI enabled by the tenant but not configured on the server', async () => {
  const { db } = mockDb({ [TENANT_A]: { webtalkEnabled: true, webtalkAiEnabled: true, webtalkRoomVersion: 0 } });
  const session = await buildWebTalkSession(db, TENANT_A, config({ aiEndpoint: null }));
  assert.ok(session.enabled);
  assert.equal(session.aiEnabled, false);
  assert.equal(session.aiEndpoint, null);
});

test('session 的房間代號跟著房間版本走', async () => {
  const { db } = mockDb({ [TENANT_A]: { webtalkEnabled: true, webtalkAiEnabled: false, webtalkRoomVersion: 5 } });
  const session = await buildWebTalkSession(db, TENANT_A, config());
  assert.ok(session.enabled);
  assert.equal(session.roomId, deriveWebTalkRoomId(SECRET, 'open333crm-test', TENANT_A, 5));
});
