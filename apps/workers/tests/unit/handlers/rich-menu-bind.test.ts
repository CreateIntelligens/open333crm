import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { Job } from 'bullmq';
import type { ChannelPlugin } from '@open333crm/channel-plugins';
import { handleRichMenuBindJob } from '#src/handlers/rich-menu-bind.handler';

/**
 * rich-menu-bind worker handler 測試（rich-menu-audience-targeting 第 3 塊）。
 * 驗：link 呼叫 plugin.extensions.ui.linkMenuToUsers、unlink 呼叫 unlink、
 * channel 不屬租戶則 skip、uids 空則不呼叫。
 */

// Workers 缺少金鑰時拒絕解密（credential-encryption），測試自己設定金鑰
process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';
const ALGORITHM = 'aes-256-gcm';
function encryptCredentials(plain: Record<string, unknown>): string {
  const key = scryptSync(
    process.env.CREDENTIAL_ENCRYPTION_KEY!,
    'open333crm-credentials',
    32,
  );
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let enc = cipher.update(JSON.stringify(plain), 'utf8', 'hex');
  enc += cipher.final('hex');
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc}`;
}

function makePlugin(calls: { link: number; unlink: number; lastUids: string[] }): ChannelPlugin {
  return {
    channelType: 'LINE',
    verifySignature: () => true,
    parseWebhook: async () => [],
    getProfile: async (uid: string) => ({ uid, displayName: uid }),
    sendMessage: async () => ({ success: true }),
    extensions: {
      ui: {
        async linkMenuToUsers(uids: string[]) { calls.link++; calls.lastUids = uids; },
        async unlinkMenuFromUsers(uids: string[]) { calls.unlink++; calls.lastUids = uids; },
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** menu：資料庫裡的選單（undefined 表示已刪除）；richMenuReads 記錄 workers 有沒有查選單 */
function makePrisma(channelExists: boolean, menu?: { status: string; lineRichMenuId: string | null }, reads = { count: 0 }) {
  return {
    richMenu: {
      async findFirst() {
        reads.count++;
        return menu ?? null;
      },
    },
    channel: {
      async findFirst() {
        return channelExists
          ? { credentialsEncrypted: encryptCredentials({ channelAccessToken: 'line-token' }) }
          : null;
      },
    },
  };
}

const job = (data: Record<string, unknown>) => ({ id: 'j1', name: 'bind', data } as unknown as Job);

async function testLinkCallsPluginUi() {
  const calls = { link: 0, unlink: 0, lastUids: [] as string[] };
  const registry = new Map([['LINE', makePlugin(calls)]]);
  await handleRichMenuBindJob(
    job({ tenantId: 't1', channelId: 'c1', lineRichMenuId: 'rm1', uids: ['u1', 'u2'], op: 'link' }),
    makePrisma(true) as any,
    registry,
  );
  assert.equal(calls.link, 1);
  assert.equal(calls.unlink, 0);
  assert.deepEqual(calls.lastUids, ['u1', 'u2']);
}

async function testUnlinkCallsPluginUi() {
  const calls = { link: 0, unlink: 0, lastUids: [] as string[] };
  const registry = new Map([['LINE', makePlugin(calls)]]);
  await handleRichMenuBindJob(
    job({ tenantId: 't1', channelId: 'c1', lineRichMenuId: 'rm1', uids: ['u1'], op: 'unlink' }),
    makePrisma(true) as any,
    registry,
  );
  assert.equal(calls.unlink, 1);
  assert.equal(calls.link, 0);
}

async function testChannelNotInTenantSkips() {
  const calls = { link: 0, unlink: 0, lastUids: [] as string[] };
  const registry = new Map([['LINE', makePlugin(calls)]]);
  await handleRichMenuBindJob(
    job({ tenantId: 't1', channelId: 'c1', lineRichMenuId: 'rm1', uids: ['u1'], op: 'link' }),
    makePrisma(false) as any, // channel 查無（不屬租戶）
    registry,
  );
  assert.equal(calls.link, 0); // 不呼叫 plugin
}

async function testEmptyUidsNoop() {
  const calls = { link: 0, unlink: 0, lastUids: [] as string[] };
  const registry = new Map([['LINE', makePlugin(calls)]]);
  await handleRichMenuBindJob(
    job({ tenantId: 't1', channelId: 'c1', lineRichMenuId: 'rm1', uids: [], op: 'link' }),
    makePrisma(true) as any,
    registry,
  );
  assert.equal(calls.link, 0);
}

// spec line-rich-menu「背景綁定只綁到仍在發布中的選單」（change migrate-line-tenant-ctx）
async function bindWithMenu(menu: { status: string; lineRichMenuId: string | null } | undefined, op = 'link') {
  const calls = { link: 0, unlink: 0, lastUids: [] as string[] };
  const reads = { count: 0 };
  await handleRichMenuBindJob(
    job({ tenantId: 't1', channelId: 'c1', richMenuId: 'm1', lineRichMenuId: 'rm1', uids: ['u1'], op }),
    makePrisma(true, menu, reads) as any,
    new Map([['LINE', makePlugin(calls)]]),
  );
  return { calls, reads };
}

test('綁定工作晚於取消發布執行：選單已是 draft，不呼叫 LINE 綁定', async () => {
  const { calls } = await bindWithMenu({ status: 'draft', lineRichMenuId: null });
  assert.equal(calls.link, 0);
});

test('綁定工作晚於重新發布執行：LINE 端的選單 id 已改變，不呼叫 LINE 綁定', async () => {
  const { calls } = await bindWithMenu({ status: 'published', lineRichMenuId: 'rm2' });
  assert.equal(calls.link, 0);
});

test('選單已刪除：不呼叫 LINE 綁定', async () => {
  const { calls } = await bindWithMenu(undefined);
  assert.equal(calls.link, 0);
});

test('選單仍在發布中：呼叫 LINE 綁定', async () => {
  const { calls } = await bindWithMenu({ status: 'published', lineRichMenuId: 'rm1' });
  assert.equal(calls.link, 1);
});

test('解除綁定不查選單，照常執行', async () => {
  const { calls, reads } = await bindWithMenu({ status: 'draft', lineRichMenuId: null }, 'unlink');
  assert.equal(calls.unlink, 1);
  assert.equal(reads.count, 0);
});

// 部署前送出的工作沒有 richMenuId：照舊執行，不查選單
test('link calls plugin ui', testLinkCallsPluginUi);
test('unlink calls plugin ui', testUnlinkCallsPluginUi);
test('channel not in tenant skips', testChannelNotInTenantSkips);
test('empty uids noop', testEmptyUidsNoop);
