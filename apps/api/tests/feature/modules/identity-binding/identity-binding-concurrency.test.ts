/**
 * 綁定代碼確認時的並行情境（change enforce-merge-same-channel-guard；AUDIT IDENT-03）。
 * 對應 spec cross-channel-binding-code「確認時合併被拒絕須回覆顧客」。
 *
 * 並行需要兩個各自提交的交易，不能用 rollback 隔離：每筆資料都記下 id，afterAll 刪除。
 * 先確認的一方完成合併後停在提交前（gate），讓後確認的一方在它提交前開始：
 * 後確認的一方合併前的檢查看不到還沒提交的合併、會通過，到合併引擎才被擋下。
 *
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { withTenant, type TenantDb } from '#src/lib/tenant-db.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';
import { TENANT_A } from '#tests/setup/feature-config.js';
import { extractBindingCode } from '#src/modules/identity-binding/binding-code.js';
import { BINDING_TEXT } from '#src/modules/identity-binding/binding-links.js';
import {
  confirmBinding,
  issueBindingCode,
  redeemBindingCode,
  type BindingActor,
  type BindingDeps,
} from '#src/modules/identity-binding/identity-binding.service.js';

const prisma = new PrismaClient();
const T = TENANT_A;
const stamp = Date.now();
const HOLD_MS = 500;

const created = { channels: [] as string[], contacts: [] as string[], uids: [] as string[] };
const db = <R>(fn: (tx: TenantDb) => Promise<R>) => withTenant(prisma, T, fn);

const clock = { now: Date.now() };
const sent: Array<{ conversationId: string; text: string }> = [];
const deps: BindingDeps = {
  store: memBindingStore(clock),
  now: () => clock.now,
  deliver: async (_db, conversationId, text) => {
    sent.push({ conversationId, text });
    return true;
  },
};

async function channel(channelType: 'LINE' | 'FB', settings: object) {
  const ch = await db((tx) =>
    tx.channel.create({
      data: { tenantId: T, channelType, displayName: `綁定並行 ${channelType}-${stamp}`, credentialsEncrypted: 'x', settings, isActive: true },
    }),
  );
  created.channels.push(ch.id);
  return ch;
}

async function person(name: string, ch: { id: string; channelType: string }): Promise<BindingActor> {
  const uid = `${name}-${stamp}`;
  const actor = await db(async (tx) => {
    const contact = await tx.contact.create({ data: { tenantId: T, displayName: `${name}-${stamp}` } });
    const identity = await tx.channelIdentity.create({
      data: { contactId: contact.id, channelId: ch.id, channelType: ch.channelType as never, uid },
    });
    const conv = await tx.conversation.create({
      data: { tenantId: T, contactId: contact.id, channelId: ch.id, channelType: ch.channelType as never },
    });
    return {
      tenantId: T,
      channelId: ch.id,
      channelType: ch.channelType,
      channelIdentityId: identity.id,
      uid,
      contactId: contact.id,
      conversationId: conv.id,
    };
  });
  created.contacts.push(actor.contactId);
  created.uids.push(uid);
  return actor;
}

async function codeFrom(issuer: BindingActor): Promise<string> {
  assert.equal((await db((tx) => issueBindingCode(tx, deps, issuer))).status, 'sent');
  return extractBindingCode(sent.filter((s) => s.conversationId === issuer.conversationId).at(-1)!.text)!;
}

const line = await channel('LINE', { bindingHandleAuto: `@line${stamp}` });
const fb = await channel('FB', { bindingHandle: `page.${stamp}` });

afterAll(async () => {
  await db(async (tx) => {
    await tx.contactMergeLog.deleteMany({
      where: { tenantId: T, OR: [{ survivorId: { in: created.contacts } }, { mergedId: { in: created.contacts } }] },
    });
    await tx.identityMap.deleteMany({ where: { tenantId: T, uid: { in: created.uids } } });
    await tx.conversation.deleteMany({ where: { tenantId: T, channelId: { in: created.channels } } });
    await tx.channelIdentity.deleteMany({ where: { channelId: { in: created.channels } } });
    await tx.contact.deleteMany({ where: { tenantId: T, id: { in: created.contacts } } });
    await tx.channel.deleteMany({ where: { tenantId: T, id: { in: created.channels } } });
  });
  await prisma.$disconnect();
});

test('確認時另一個綁定剛完成：後確認的一方收到同一渠道說明、不被合併、不留待確認', async () => {
  const b = await person('B', fb);
  const a1 = await person('A1', line);
  const a2 = await person('A2', line);
  // 發碼方發兩組代碼，各給同一個 LINE 官方帳號的一位使用者
  const code1 = await codeFrom(b);
  const code2 = await codeFrom(b);
  assert.equal((await db((tx) => redeemBindingCode(tx, deps, a1, code1))).status, 'pending_confirm');
  assert.equal((await db((tx) => redeemBindingCode(tx, deps, a2, code2))).status, 'pending_confirm');

  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let firstDone!: () => void;
  const firstConfirmed = new Promise<void>((r) => (firstDone = r));
  const tx1 = db(async (tx) => {
    const out = await confirmBinding(tx, deps, a1);
    firstDone();
    await gate;
    return out;
  });
  await firstConfirmed;
  const tx2 = db((tx) => confirmBinding(tx, deps, a2));
  await new Promise((r) => setTimeout(r, HOLD_MS));
  release();
  const [r1, r2] = await Promise.allSettled([tx1, tx2]);

  assert.equal(r1.status === 'fulfilled' && r1.value.status, 'bound');
  assert.equal(r2.status, 'fulfilled', `後確認的一方不可丟錯：${r2.status === 'rejected' ? String(r2.reason) : ''}`);
  assert.equal((r2 as PromiseFulfilledResult<{ status: string }>).value.status, 'channel_conflict');
  assert.ok(
    sent.some((s) => s.conversationId === a2.conversationId && s.text === BINDING_TEXT.channelConflict),
    '後確認的一方要收到同一渠道只能綁定一個帳號的說明',
  );

  const a2Row = await db((tx) => tx.contact.findFirst({ where: { tenantId: T, id: a2.contactId } }));
  assert.equal(a2Row?.isArchived, false);
  assert.equal(a2Row?.mergedIntoId, null);
  assert.equal((await db((tx) => confirmBinding(tx, deps, a2))).status, 'no_pending', '不恢復待確認狀態');
});
