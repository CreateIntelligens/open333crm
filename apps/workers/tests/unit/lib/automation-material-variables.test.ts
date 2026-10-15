/**
 * 關鍵字回覆送素材時代入聯絡人變數（M01，2026-10-15 手冊盤點發現）。
 *
 * 修正前：send_material 只用規則 params.variables（關鍵字回覆從不帶）替換，
 * 素材裡的 {{contact.name}} 原樣送給客人；畫面卻寫「會以預設值送出」。
 * 廣播（apps/api template-context）會用聯絡人資料與素材預設值替換，這裡比照。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { ChannelPlugin, OutboundPayload } from '@open333crm/channel-plugins';
import { executeWorkerAutomationActions } from '#src/lib/automation-actions';

process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';

function encryptCredentials(plain: Record<string, unknown>): string {
  const key = scryptSync(process.env.CREDENTIAL_ENCRYPTION_KEY!, 'open333crm-credentials', 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(JSON.stringify(plain), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted}`;
}

function setup(contact: Record<string, unknown> | null) {
  const sends: OutboundPayload[] = [];
  const contactQueries: Array<{ where: Record<string, unknown> }> = [];
  const plugin: ChannelPlugin = {
    channelType: 'LINE',
    verifySignature: () => true,
    parseWebhook: async () => [],
    getProfile: async (uid: string) => ({ uid, displayName: uid }),
    sendMessage: async (_to, payload) => {
      sends.push(payload);
      return { success: true, channelMsgId: 'm-1' };
    },
  };
  const prisma = {
    material: {
      findFirst: async () => ({
        name: '歡迎',
        contentType: 'line_text',
        channelType: 'line',
        body: { text: '{{contact.name}} 您好，電話 {{contact.phone}}，Email {{contact.email}}，等級 {{attribute.level}}' },
        variables: [{ key: 'contact.phone', defaultValue: '未提供' }],
      }),
    },
    contact: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        contactQueries.push(args);
        return contact;
      },
    },
    conversation: {
      findFirst: async () => ({ id: 'conv-1', tenantId: 'tenant-1', contactId: 'contact-1', channel: { channelType: 'LINE' } }),
      findUnique: async () => ({
        id: 'conv-1',
        tenantId: 'tenant-1',
        channel: {
          id: 'channel-1',
          channelType: 'LINE',
          isActive: true,
          credentialsEncrypted: encryptCredentials({ channelAccessToken: 't' }),
        },
        contact: { channelIdentities: [{ channelId: 'channel-1', uid: 'u-1' }] },
      }),
      update: async () => ({}),
    },
    message: {
      create: async (args: { data: Record<string, unknown> }) => ({ id: 'msg-1', createdAt: new Date(), ...args.data }),
    },
  };
  return { prisma, plugin, sends, contactQueries };
}

async function run(f: ReturnType<typeof setup>) {
  await executeWorkerAutomationActions(
    f.prisma as any,
    { publish: async () => 1 } as any,
    [{ type: 'send_material', params: { materialId: 'mat-1' } }],
    { tenantId: 'tenant-1', conversationId: 'conv-1', trigger: 'keyword.matched', pluginRegistry: new Map([['LINE', f.plugin]]) },
  );
}

test('素材變數用對話聯絡人的資料代入，缺值用素材預設值，沒有預設值的留空，不送出大括號', async () => {
  const f = setup({ displayName: '王小明', phone: null, email: 'ming@example.com', attributes: [{ key: 'level', value: '金卡' }] });
  await run(f);
  assert.equal(f.sends.length, 1);
  const text = (f.sends[0].content as { text: string }).text;
  assert.equal(text, '王小明 您好，電話 未提供，Email ming@example.com，等級 金卡');
  // workers 走 BYPASSRLS 連線：查聯絡人必須帶 tenantId
  assert.equal(f.contactQueries[0].where.tenantId, 'tenant-1');
  assert.equal(f.contactQueries[0].where.id, 'contact-1');
});

test('找不到聯絡人時變數用預設值或留空，仍然送出', async () => {
  const f = setup(null);
  await run(f);
  const text = (f.sends[0].content as { text: string }).text;
  assert.equal(text, ' 您好，電話 未提供，Email ，等級 ');
});
