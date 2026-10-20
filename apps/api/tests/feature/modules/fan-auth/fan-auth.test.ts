/**
 * Account Link 身分驗證測試（design D11）。
 *
 * 需要真實 Redis —— nonce 與票據的「一次性消費」是原子操作保證，
 * mock 掉就測不到重放防護這個重點。
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 * service 以 app_tenant 連線呼叫（RLS 生效）；建立與清理資料用 owner 連線，
 * 本檔建立的聯絡人都帶唯一標記，於 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { redis } from '@open333crm/core';
import {
  generateNonce,
  storeNonce,
  consumeNonce,
} from '#src/modules/fan-auth/account-link.service.js';
import { completeBinding, isVerified, LINE_VERIFIED_KEY } from '#src/modules/fan-auth/fan-binding.service.js';
import { issueAuthTicket, consumeAuthTicket } from '#src/modules/fan-auth/auth-ticket.service.js';
import {
  storeBindingTicket,
  takeBindingTicket,
  storeBindingFailure,
  takeBindingFailure,
} from '#src/modules/fan-auth/binding-ticket-store.js';

const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const tenantId = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const MARK = `fan-auth-test-${Date.now()}`;
const channelId = randomUUID();
const lineUid = `U${randomUUID().replace(/-/g, '')}`;
let contactId = '';

async function mkContact(name: string): Promise<string> {
  const c = await owner.contact.create({ data: { tenantId, displayName: `${MARK}-${name}` } });
  return c.id;
}

beforeAll(async () => {
  contactId = await mkContact('測試顧客');
});

afterAll(async () => {
  const contacts = { tenantId, displayName: { startsWith: MARK } };
  await owner.contactAttribute.deleteMany({ where: { contact: contacts } });
  await owner.contact.deleteMany({ where: contacts });
  await owner.$disconnect();
  await tenantDb.$disconnect();
  redis.disconnect();
});

// ── nonce ──
it('nonce 可存取並正確還原', async () => {
  const n = generateNonce();
  await storeNonce(n, { tenantId, contactId, channelId, lineUid, createdAt: Date.now() });
  const got = await consumeNonce(n);
  assert.equal(got?.contactId, contactId);
  assert.equal(got?.lineUid, lineUid);
});

it('nonce 一次性：第二次取回為 null', async () => {
  const n = generateNonce();
  await storeNonce(n, { tenantId, contactId, channelId, lineUid, createdAt: Date.now() });
  await consumeNonce(n);
  const again = await consumeNonce(n);
  assert.equal(again, null, 'nonce 竟可重複使用（重放風險）');
});

it('併發消費同一 nonce 僅一個成功', async () => {
  const n = generateNonce();
  await storeNonce(n, { tenantId, contactId, channelId, lineUid, createdAt: Date.now() });
  const results = await Promise.all(Array.from({ length: 10 }, () => consumeNonce(n)));
  const got = results.filter((r) => r !== null).length;
  assert.equal(got, 1, `10 個併發消費有 ${got} 個拿到，應恰為 1`);
});

// ── 綁定流程 ──
it('result=ok 完成綁定並寫入 ContactAttribute', async () => {
  const n = generateNonce();
  await storeNonce(n, { tenantId, contactId, channelId, lineUid, createdAt: Date.now() });
  const r = await completeBinding(tenantDb, { nonce: n, result: 'ok', lineUid });
  assert.ok(r.ok, `綁定失敗：${JSON.stringify(r)}`);
  const verified = await isVerified(tenantDb, tenantId, contactId);
  assert.ok(verified, '未寫入驗證標記');
});

it('綁定標記使用 ContactAttribute 而非新表', async () => {
  const rows = await owner.contactAttribute.findMany({
    where: { contactId, key: LINE_VERIFIED_KEY },
    select: { key: true },
  });
  assert.equal(rows.length, 1, '未寫入 ContactAttribute');
});

it('result=failed 不寫入資料並回報驗證失敗', async () => {
  const otherContact = await mkContact('失敗顧客');
  const n = generateNonce();
  await storeNonce(n, { tenantId, contactId: otherContact, channelId, lineUid, createdAt: Date.now() });
  const r = await completeBinding(tenantDb, { nonce: n, result: 'failed', lineUid });
  assert.ok(!r.ok && r.reason === 'VERIFICATION_FAILED', `預期驗證失敗，實得 ${JSON.stringify(r)}`);
  const verified = await isVerified(tenantDb, tenantId, otherContact);
  assert.ok(!verified, '驗證失敗竟仍寫入標記');
});

it('nonce 查無與驗證失敗分別回報', async () => {
  const r = await completeBinding(tenantDb, { nonce: generateNonce(), result: 'ok' });
  assert.ok(!r.ok && r.reason === 'NONCE_NOT_FOUND', `預期 NONCE_NOT_FOUND，實得 ${JSON.stringify(r)}`);
});

it('事件 uid 與發起時不符須拒絕綁定', async () => {
  const victim = await mkContact('受害顧客');
  const n = generateNonce();
  await storeNonce(n, { tenantId, contactId: victim, channelId, lineUid, createdAt: Date.now() });
  const r = await completeBinding(tenantDb, { nonce: n, result: 'ok', lineUid: 'U_attacker_different_uid' });
  assert.ok(!r.ok, 'uid 不符竟完成綁定');
  const verified = await isVerified(tenantDb, tenantId, victim);
  assert.ok(!verified, 'uid 不符竟寫入標記');
});

it('綁定至不存在的聯絡人須回報而非拋錯', async () => {
  const n = generateNonce();
  await storeNonce(n, { tenantId, contactId: randomUUID(), channelId, lineUid, createdAt: Date.now() });
  const r = await completeBinding(tenantDb, { nonce: n, result: 'ok', lineUid });
  assert.ok(!r.ok && r.reason === 'CONTACT_NOT_FOUND', `預期 CONTACT_NOT_FOUND，實得 ${JSON.stringify(r)}`);
});

// ── 認證票據 ──
it('票據可換回身分且為一次性', async () => {
  const ticket = await issueAuthTicket({ tenantId, contactId });
  const got = await consumeAuthTicket(ticket);
  assert.equal(got?.contactId, contactId);
  const again = await consumeAuthTicket(ticket);
  assert.equal(again, null, '票據竟可重複使用');
});

it('偽造票據無法換取身分', async () => {
  const got = await consumeAuthTicket('forged-ticket-value');
  assert.equal(got, null, '偽造票據竟通過');
});

it('併發使用同一票據僅一個成功', async () => {
  const ticket = await issueAuthTicket({ tenantId, contactId });
  const results = await Promise.all(Array.from({ length: 10 }, () => consumeAuthTicket(ticket)));
  const got = results.filter((r) => r !== null).length;
  assert.equal(got, 1, `10 個併發有 ${got} 個成功，應恰為 1`);
});

// ── 票據交付 ──
it('以 nonce 取回票據並一次性失效', async () => {
  const n = generateNonce();
  await storeBindingTicket(n, 'ticket-abc');
  assert.equal(await takeBindingTicket(n), 'ticket-abc');
  assert.equal(await takeBindingTicket(n), null, '票據交付竟可重複取得');
});

it('綁定失敗原因可供顧客端取回', async () => {
  const n = generateNonce();
  await storeBindingFailure(n, 'VERIFICATION_FAILED');
  assert.equal(await takeBindingFailure(n), 'VERIFICATION_FAILED');
  assert.equal(await takeBindingFailure(n), null);
});
