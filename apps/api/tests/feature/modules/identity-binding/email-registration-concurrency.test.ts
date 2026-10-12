/**
 * Email 登記的並行情境（change enforce-merge-same-channel-guard；AUDIT IDENT-03、IDENT-04）。
 * 對應 spec email-identity-merge「同一渠道雙方都有身分時拒絕合併」的「合併時才發現同一渠道」，
 * 與「同一個 email 的登記依序處理」。
 *
 * 並行需要兩個各自提交的交易，不能用 rollback 隔離：每筆資料都記下 id，afterAll 刪除。
 * 先開的交易做完登記後停在提交前（gate），讓後開的交易在它提交前開始，結果不靠時序運氣：
 * - 後開的交易被鎖擋住時，要等 gate 放開才會完成
 * - 沒有被擋住時，它看不到前一個交易還沒提交的寫入
 *
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { withTenant, type TenantDb } from '#src/lib/tenant-db.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';
import { waitForLockWait } from '#tests/support/wait-for-lock-wait.js';
import { TENANT_A } from '#tests/setup/feature-config.js';
import type { BindingActor } from '#src/modules/identity-binding/binding-common.js';
import { mergeContacts } from '#src/modules/contact/contact-merge.service.js';
import {
  issueEmailRegistrationLink,
  submitEmailRegistration,
  type EmailRegistrationDeps,
} from '#src/modules/identity-binding/email-registration.service.js';

const prisma = new PrismaClient();
const T = TENANT_A;
const stamp = Date.now();
/** 不該被擋住的交易，最多等這麼久完成 */
const NOT_BLOCKED_TIMEOUT_MS = 10_000;

const created = { channels: [] as string[], contacts: [] as string[], uids: [] as string[] };
const db = <R>(fn: (tx: TenantDb) => Promise<R>) => withTenant(prisma, T, fn);

const clock = { now: Date.now() };
const sent: Array<{ conversationId: string; text: string }> = [];
const deps: EmailRegistrationDeps = {
  store: memBindingStore(clock),
  now: () => clock.now,
  webBaseUrl: 'https://crm.example.com',
  deliver: async (_db, conversationId, text) => {
    sent.push({ conversationId, text });
    return true;
  },
};

async function channel(channelType: 'LINE' | 'FB') {
  const ch = await db((tx) =>
    tx.channel.create({
      data: { tenantId: T, channelType, displayName: `並行測試 ${channelType}-${stamp}`, credentialsEncrypted: 'x', isActive: true },
    }),
  );
  created.channels.push(ch.id);
  return ch;
}

/** 建立聯絡人（含一個渠道身分與對話），createdAt 由呼叫順序決定 */
async function person(name: string, ch: { id: string; channelType: string }, email: string | null = null): Promise<BindingActor> {
  const uid = `${name}-${stamp}`;
  const actor = await db(async (tx) => {
    const contact = await tx.contact.create({ data: { tenantId: T, displayName: `${name}-${stamp}`, email } });
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
  // 讓下一位的 createdAt 一定比較晚
  await new Promise((r) => setTimeout(r, 5));
  return actor;
}

async function tokenFor(actor: BindingActor): Promise<string> {
  assert.equal((await db((tx) => issueEmailRegistrationLink(tx, deps, actor))).status, 'sent');
  const msg = sent.filter((s) => s.conversationId === actor.conversationId).at(-1)!;
  return /\/bind\/email\/([A-Za-z0-9_-]+)/.exec(msg.text)![1];
}

/**
 * 先在交易 1 送出 first，停在提交前；交易 1 做完後才開始交易 2 送出 second。
 * secondBlocks：交易 2 應卡在交易 1 的鎖上——確認它在等鎖後才放開交易 1；
 * 否則等交易 2 自己完成（逾時就放開）再放開交易 1。
 * 回傳兩邊的結果與交易 2 是否在交易 1 提交前就完成。
 */
async function raceSubmit(
  first: { token: string; email: string },
  second: { token: string; email: string },
  { secondBlocks }: { secondBlocks: boolean },
) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let firstDone!: () => void;
  const firstSubmitted = new Promise<void>((r) => (firstDone = r));
  let firstCommitted = false;

  const tx1 = db(async (tx) => {
    const out = await submitEmailRegistration(tx, deps, first.token, first.email);
    firstDone();
    await gate;
    return out;
  }).finally(() => {
    firstCommitted = true;
  });
  await firstSubmitted;
  let secondFinishedBeforeFirstCommit = false;
  const tx2 = db((tx) => submitEmailRegistration(tx, deps, second.token, second.email)).then((out) => {
    secondFinishedBeforeFirstCommit = !firstCommitted;
    return out;
  });
  if (secondBlocks) {
    await waitForLockWait(prisma);
  } else {
    await Promise.race([tx2.catch(() => {}), new Promise((r) => setTimeout(r, NOT_BLOCKED_TIMEOUT_MS))]);
  }
  release();
  const [r1, r2] = await Promise.allSettled([tx1, tx2]);
  return { r1, r2, secondFinishedBeforeFirstCommit };
}

const contactRow = (id: string) =>
  db((tx) => tx.contact.findFirst({ where: { tenantId: T, id }, select: { email: true, isArchived: true, mergedIntoId: true } }));

const line = await channel('LINE');
const fb = await channel('FB');

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

test('合併時才發現同一渠道：登記方 channel_conflict、email 不變、收到說明、未被封存', async () => {
  // 另一個併入 B 的合併不能是同一個 email 的登記：那會被 email 鎖擋住，後一方在合併前的檢查就被攔下，
  // 測不到合併引擎拒絕的這條路。這裡用客服手動合併把 A1 併入 B，停在提交前
  const email = `same-ch-${stamp}@example.com`;
  const b = await person('B', fb, email);
  const a1 = await person('A1', line);
  const a2 = await person('A2', line);
  const t2 = await tokenFor(a2);

  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let firstDone!: () => void;
  const firstMerged = new Promise<void>((r) => (firstDone = r));
  const tx1 = db(async (tx) => {
    await mergeContacts(tx, { tenantId: T, survivorId: b.contactId, mergedId: a1.contactId, source: 'MANUAL' });
    firstDone();
    await gate;
  });
  await firstMerged;
  const tx2 = db((tx) => submitEmailRegistration(tx, deps, t2, email));
  // 登記方通過合併前檢查（看不到還沒提交的合併），卡在 B 的列鎖上，才放開客服的合併
  await waitForLockWait(prisma);
  release();
  const [r1, r2] = await Promise.allSettled([tx1, tx2]);

  assert.equal(r1.status, 'fulfilled');
  assert.equal(r2.status, 'fulfilled', `登記方不可丟錯：${r2.status === 'rejected' ? String(r2.reason) : ''}`);
  const second = (r2 as PromiseFulfilledResult<Awaited<ReturnType<typeof submitEmailRegistration>>>).value;
  assert.equal(second.result.status, 'channel_conflict');
  assert.deepEqual(
    second.notices.map((n) => [n.conversationId, n.kind]),
    [[a2.conversationId, 'email_channel_conflict']],
  );

  const a2Row = await contactRow(a2.contactId);
  assert.equal(a2Row?.email, null, 'email 不變');
  assert.equal(a2Row?.isArchived, false);
  assert.equal(a2Row?.mergedIntoId, null);
  const lineOnB = await db((tx) => tx.channelIdentity.count({ where: { contactId: b.contactId, channelId: line.id } }));
  assert.equal(lineOnB, 1);
});

test('兩位聯絡人同時登記同一個新的 email：完成後是同一位聯絡人', async () => {
  const email = `new-email-${stamp}@example.com`;
  const a = await person('NA', line);
  const b = await person('NB', fb);
  const ta = await tokenFor(a);
  const tb = await tokenFor(b);

  const { r1, r2 } = await raceSubmit({ token: ta, email }, { token: tb, email }, { secondBlocks: true });
  assert.equal(r1.status, 'fulfilled');
  assert.equal(r2.status, 'fulfilled');

  const [aRow, bRow] = await Promise.all([contactRow(a.contactId), contactRow(b.contactId)]);
  // A 較早建立：B 併入 A
  assert.equal(aRow?.isArchived, false);
  assert.equal(aRow?.email, email);
  assert.equal(bRow?.isArchived, true, 'B 應併入 A');
  assert.equal(bRow?.mergedIntoId, a.contactId);
});

test('不同 email 不互相等待：各自完成、不合併', async () => {
  const a = await person('DA', line);
  const b = await person('DB', fb);
  const ta = await tokenFor(a);
  const tb = await tokenFor(b);

  const { r1, r2, secondFinishedBeforeFirstCommit } = await raceSubmit(
    { token: ta, email: `amy-${stamp}@example.com` },
    { token: tb, email: `bob-${stamp}@example.com` },
    { secondBlocks: false },
  );
  assert.equal(r1.status === 'fulfilled' && r1.value.result.status, 'registered');
  assert.equal(r2.status === 'fulfilled' && r2.value.result.status, 'registered');
  assert.ok(secondFinishedBeforeFirstCommit, '不同 email 的登記不可被另一個登記的鎖擋住');
});
