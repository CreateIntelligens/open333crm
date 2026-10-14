/**
 * 手機登記的並行情境（change add-phone-identity-merge）。
 * 對應 spec phone-identity-merge「同一支手機的登記依序處理」：鎖以統一格式後的號碼為 key，
 * 同一支手機寫成不同格式也要依序處理。測試方式與 email-registration-concurrency.test.ts 相同：
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
import { backendPid, waitUntilBlockedBy } from '#tests/support/wait-for-lock-wait.js';
import { TENANT_A } from '#tests/setup/feature-config.js';
import type { BindingActor } from '#src/modules/identity-binding/binding-common.js';
import {
  issuePhoneRegistrationLink,
  submitPhoneRegistration,
  type PhoneRegistrationDeps,
} from '#src/modules/identity-binding/phone-registration.service.js';

const prisma = new PrismaClient();
const T = TENANT_A;
const stamp = Date.now();
/** 不該被擋住的交易，最多等這麼久完成 */
const NOT_BLOCKED_TIMEOUT_MS = 10_000;

const created = { channels: [] as string[], contacts: [] as string[], uids: [] as string[] };
const db = <R>(fn: (tx: TenantDb) => Promise<R>) => withTenant(prisma, T, fn);

const clock = { now: Date.now() };
const sent: Array<{ conversationId: string; text: string }> = [];
const deps: PhoneRegistrationDeps = {
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
      data: { tenantId: T, channelType, displayName: `手機並行測試 ${channelType}-${stamp}`, credentialsEncrypted: 'x', isActive: true },
    }),
  );
  created.channels.push(ch.id);
  return ch;
}

/** 建立聯絡人（含一個渠道身分與對話），createdAt 由呼叫順序決定 */
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
  // 讓下一位的 createdAt 一定比較晚
  await new Promise((r) => setTimeout(r, 5));
  return actor;
}

async function tokenFor(actor: BindingActor): Promise<string> {
  assert.equal((await db((tx) => issuePhoneRegistrationLink(tx, deps, actor))).status, 'sent');
  const msg = sent.filter((s) => s.conversationId === actor.conversationId).at(-1)!;
  return /\/bind\/phone\/([A-Za-z0-9_-]+)/.exec(msg.text)![1];
}

/**
 * 先在交易 1 送出 first，停在提交前；交易 1 做完後才開始交易 2 送出 second。
 * secondBlocks：交易 2 應卡在交易 1 的鎖上——確認它在等鎖後才放開交易 1；
 * 否則等交易 2 自己完成（逾時就放開）再放開交易 1。
 * 回傳兩邊的結果與交易 2 是否在交易 1 提交前就完成。
 */
async function raceSubmit(
  first: { token: string; phone: string },
  second: { token: string; phone: string },
  { secondBlocks }: { secondBlocks: boolean },
) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let firstDone!: (pid: number) => void;
  const firstSubmitted = new Promise<number>((r) => (firstDone = r));
  let firstCommitted = false;

  const tx1 = db(async (tx) => {
    const out = await submitPhoneRegistration(tx, deps, first.token, first.phone);
    firstDone(await backendPid(tx));
    await gate;
    return out;
  }).finally(() => {
    firstCommitted = true;
  });
  const firstPid = await firstSubmitted;
  let secondFinishedBeforeFirstCommit = false;
  const tx2 = db((tx) => submitPhoneRegistration(tx, deps, second.token, second.phone)).then((out) => {
    secondFinishedBeforeFirstCommit = !firstCommitted;
    return out;
  });
  try {
    if (secondBlocks) {
      await waitUntilBlockedBy(prisma, firstPid);
    } else {
      await Promise.race([tx2.catch(() => {}), new Promise((r) => setTimeout(r, NOT_BLOCKED_TIMEOUT_MS))]);
    }
  } finally {
    // 等不到時也要放開，否則交易 1 一直開著
    release();
  }
  const [r1, r2] = await Promise.allSettled([tx1, tx2]);
  return { r1, r2, secondFinishedBeforeFirstCommit };
}

const contactRow = (id: string) =>
  db((tx) => tx.contact.findFirst({ where: { tenantId: T, id }, select: { phone: true, isArchived: true, mergedIntoId: true } }));

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

/** 這次執行專用的號碼，避免與測試資料庫裡其他資料相同 */
const mobile = (n: number) => `09${String(stamp + n).slice(-8)}`;

test('兩位聯絡人同時以不同格式登記同一支新手機', async () => {
  const phone = mobile(1);
  const a = await person('NA', line);
  const b = await person('NB', fb);
  const ta = await tokenFor(a);
  const tb = await tokenFor(b);

  const { r1, r2 } = await raceSubmit(
    { token: ta, phone },
    { token: tb, phone: `+886${phone.slice(1)}` },
    { secondBlocks: true },
  );
  assert.equal(r1.status, 'fulfilled');
  assert.equal(r2.status, 'fulfilled');

  const [aRow, bRow] = await Promise.all([contactRow(a.contactId), contactRow(b.contactId)]);
  // A 較早建立：B 併入 A
  assert.equal(aRow?.isArchived, false);
  assert.equal(aRow?.phone, phone);
  assert.equal(bRow?.isArchived, true, 'B 應併入 A');
  assert.equal(bRow?.mergedIntoId, a.contactId);
});

test('不同手機不互相等待：各自完成、不合併', async () => {
  const a = await person('DA', line);
  const b = await person('DB', fb);
  const ta = await tokenFor(a);
  const tb = await tokenFor(b);

  const { r1, r2, secondFinishedBeforeFirstCommit } = await raceSubmit(
    { token: ta, phone: mobile(2) },
    { token: tb, phone: mobile(3) },
    { secondBlocks: false },
  );
  assert.equal(r1.status === 'fulfilled' && r1.value.result.status, 'registered');
  assert.equal(r2.status === 'fulfilled' && r2.value.result.status, 'registered');
  assert.ok(secondFinishedBeforeFirstCommit, '不同手機的登記不可被另一個登記的鎖擋住');
});
