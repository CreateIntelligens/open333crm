import assert from 'node:assert/strict';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { Job } from 'bullmq';
import type { ChannelPlugin } from '@open333crm/channel-plugins';
import { handleRichMenuBindJob } from '../handlers/rich-menu-bind.handler';

/**
 * rich-menu-bind worker handler 測試（rich-menu-audience-targeting 第 3 塊）。
 * 驗：link 呼叫 plugin.extensions.ui.linkMenuToUsers、unlink 呼叫 unlink、
 * channel 不屬租戶則 skip、uids 空則不呼叫。
 */

const ALGORITHM = 'aes-256-gcm';
function encryptCredentials(plain: Record<string, unknown>): string {
  const key = scryptSync(
    process.env.CREDENTIAL_ENCRYPTION_KEY ?? 'fallback-open333crm-key',
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

function makePrisma(channelExists: boolean) {
  return {
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

async function main() {
  await testLinkCallsPluginUi();
  await testUnlinkCallsPluginUi();
  await testChannelNotInTenantSkips();
  await testEmptyUidsNoop();
  console.log('rich-menu-bind tests passed');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
