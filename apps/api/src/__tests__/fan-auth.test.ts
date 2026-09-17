/**
 * Account Link 身分驗證測試（design D11）。跑法：
 *   DATABASE_URL=... REDIS_URL=... npx tsx src/__tests__/fan-auth.test.ts
 *
 * 需要真實 Redis —— nonce 與票據的「一次性消費」是原子操作保證，
 * mock 掉就測不到重放防護這個重點。
 */
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { redis } from '@open333crm/core';
import {
  generateNonce,
  storeNonce,
  consumeNonce,
  buildAccountLinkUrl,
} from '../modules/fan-auth/account-link.service.js';
import { completeBinding, isVerified, LINE_VERIFIED_KEY } from '../modules/fan-auth/fan-binding.service.js';
import { issueAuthTicket, consumeAuthTicket } from '../modules/fan-auth/auth-ticket.service.js';
import {
  storeBindingTicket,
  takeBindingTicket,
  storeBindingFailure,
  takeBindingFailure,
} from '../modules/fan-auth/binding-ticket-store.js';

const prisma = new PrismaClient();
let pass = 0;
let fail = 0;

async function t(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
    pass += 1;
  } catch (err) {
    console.log(`FAIL  ${name}\n      ${(err as Error).message}`);
    fail += 1;
  }
}

async function main() {
  const tenantId = randomUUID();
  const contactId = randomUUID();
  const channelId = randomUUID();
  const lineUid = `U${randomUUID().replace(/-/g, '')}`;

  await prisma.$executeRawUnsafe(`INSERT INTO tenants (id, name, "updatedAt") VALUES ($1::uuid,$2,now())`, tenantId, '綁定測試租戶');
  await prisma.$executeRawUnsafe(`INSERT INTO contacts (id, "tenantId", "displayName", "updatedAt") VALUES ($1::uuid,$2::uuid,$3,now())`, contactId, tenantId, '測試顧客');

  // ── nonce ──
  await t('nonce 為 CSPRNG 且長度足夠（≥128 bit）', async () => {
    const n = generateNonce();
    // base64url 編碼 32 bytes → 43 字元
    assert.ok(n.length >= 22, `nonce 過短：${n.length} 字元`);
    const seen = new Set(Array.from({ length: 500 }, () => generateNonce()));
    assert.equal(seen.size, 500, 'nonce 出現重複，亂數來源可疑');
  });

  await t('nonce 可存取並正確還原', async () => {
    const n = generateNonce();
    await storeNonce(n, { tenantId, contactId, channelId, lineUid, createdAt: Date.now() });
    const got = await consumeNonce(n);
    assert.equal(got?.contactId, contactId);
    assert.equal(got?.lineUid, lineUid);
  });

  await t('nonce 一次性：第二次取回為 null', async () => {
    const n = generateNonce();
    await storeNonce(n, { tenantId, contactId, channelId, lineUid, createdAt: Date.now() });
    await consumeNonce(n);
    const again = await consumeNonce(n);
    assert.equal(again, null, 'nonce 竟可重複使用（重放風險）');
  });

  await t('併發消費同一 nonce 僅一個成功', async () => {
    const n = generateNonce();
    await storeNonce(n, { tenantId, contactId, channelId, lineUid, createdAt: Date.now() });
    const results = await Promise.all(Array.from({ length: 10 }, () => consumeNonce(n)));
    const got = results.filter((r) => r !== null).length;
    assert.equal(got, 1, `10 個併發消費有 ${got} 個拿到，應恰為 1`);
  });

  await t('連動網址格式正確且參數已編碼', async () => {
    const url = buildAccountLinkUrl('tok+en/123', 'non+ce/456');
    assert.ok(url.startsWith('https://access.line.me/dialog/bot/accountLink?'), '網址前綴不正確');
    assert.ok(!url.includes('tok+en/123'), '參數未經編碼');
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('linkToken'), 'tok+en/123');
    assert.equal(parsed.searchParams.get('nonce'), 'non+ce/456');
  });

  // ── 綁定流程 ──
  await t('result=ok 完成綁定並寫入 ContactAttribute', async () => {
    const n = generateNonce();
    await storeNonce(n, { tenantId, contactId, channelId, lineUid, createdAt: Date.now() });
    const r = await completeBinding(prisma, { nonce: n, result: 'ok', lineUid });
    assert.ok(r.ok, `綁定失敗：${JSON.stringify(r)}`);
    const verified = await isVerified(prisma, tenantId, contactId);
    assert.ok(verified, '未寫入驗證標記');
  });

  await t('綁定標記使用 ContactAttribute 而非新表', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ key: string }>>(
      `SELECT key FROM contact_attributes WHERE "contactId" = $1::uuid AND key = $2`,
      contactId, LINE_VERIFIED_KEY,
    );
    assert.equal(rows.length, 1, '未寫入 ContactAttribute');
  });

  await t('result=failed 不寫入資料並回報驗證失敗', async () => {
    const otherContact = randomUUID();
    await prisma.$executeRawUnsafe(`INSERT INTO contacts (id, "tenantId", "displayName", "updatedAt") VALUES ($1::uuid,$2::uuid,$3,now())`, otherContact, tenantId, '失敗顧客');
    const n = generateNonce();
    await storeNonce(n, { tenantId, contactId: otherContact, channelId, lineUid, createdAt: Date.now() });
    const r = await completeBinding(prisma, { nonce: n, result: 'failed', lineUid });
    assert.ok(!r.ok && r.reason === 'VERIFICATION_FAILED', `預期驗證失敗，實得 ${JSON.stringify(r)}`);
    const verified = await isVerified(prisma, tenantId, otherContact);
    assert.ok(!verified, '驗證失敗竟仍寫入標記');
  });

  await t('nonce 查無與驗證失敗分別回報', async () => {
    const r = await completeBinding(prisma, { nonce: generateNonce(), result: 'ok' });
    assert.ok(!r.ok && r.reason === 'NONCE_NOT_FOUND', `預期 NONCE_NOT_FOUND，實得 ${JSON.stringify(r)}`);
  });

  await t('事件 uid 與發起時不符須拒絕綁定', async () => {
    const victim = randomUUID();
    await prisma.$executeRawUnsafe(`INSERT INTO contacts (id, "tenantId", "displayName", "updatedAt") VALUES ($1::uuid,$2::uuid,$3,now())`, victim, tenantId, '受害顧客');
    const n = generateNonce();
    await storeNonce(n, { tenantId, contactId: victim, channelId, lineUid, createdAt: Date.now() });
    const r = await completeBinding(prisma, { nonce: n, result: 'ok', lineUid: 'U_attacker_different_uid' });
    assert.ok(!r.ok, 'uid 不符竟completed綁定');
    const verified = await isVerified(prisma, tenantId, victim);
    assert.ok(!verified, 'uid 不符竟寫入標記');
  });

  await t('綁定至不存在的聯絡人須回報而非拋錯', async () => {
    const n = generateNonce();
    await storeNonce(n, { tenantId, contactId: randomUUID(), channelId, lineUid, createdAt: Date.now() });
    const r = await completeBinding(prisma, { nonce: n, result: 'ok', lineUid });
    assert.ok(!r.ok && r.reason === 'CONTACT_NOT_FOUND', `預期 CONTACT_NOT_FOUND，實得 ${JSON.stringify(r)}`);
  });

  // ── 認證票據 ──
  await t('票據可換回身分且為一次性', async () => {
    const ticket = await issueAuthTicket({ tenantId, contactId });
    const got = await consumeAuthTicket(ticket);
    assert.equal(got?.contactId, contactId);
    const again = await consumeAuthTicket(ticket);
    assert.equal(again, null, '票據竟可重複使用');
  });

  await t('偽造票據無法換取身分', async () => {
    const got = await consumeAuthTicket('forged-ticket-value');
    assert.equal(got, null, '偽造票據竟通過');
  });

  await t('併發使用同一票據僅一個成功', async () => {
    const ticket = await issueAuthTicket({ tenantId, contactId });
    const results = await Promise.all(Array.from({ length: 10 }, () => consumeAuthTicket(ticket)));
    const got = results.filter((r) => r !== null).length;
    assert.equal(got, 1, `10 個併發有 ${got} 個成功，應恰為 1`);
  });

  // ── 票據交付 ──
  await t('以 nonce 取回票據並一次性失效', async () => {
    const n = generateNonce();
    await storeBindingTicket(n, 'ticket-abc');
    assert.equal(await takeBindingTicket(n), 'ticket-abc');
    assert.equal(await takeBindingTicket(n), null, '票據交付竟可重複取得');
  });

  await t('綁定失敗原因可供顧客端取回', async () => {
    const n = generateNonce();
    await storeBindingFailure(n, 'VERIFICATION_FAILED');
    assert.equal(await takeBindingFailure(n), 'VERIFICATION_FAILED');
    assert.equal(await takeBindingFailure(n), null);
  });

  // 清理
  await prisma.$executeRawUnsafe(`DELETE FROM contact_attributes WHERE "contactId" IN (SELECT id FROM contacts WHERE "tenantId" = $1::uuid)`, tenantId);
  await prisma.$executeRawUnsafe(`DELETE FROM contacts WHERE "tenantId" = $1::uuid`, tenantId);
  await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1::uuid`, tenantId);

  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('測試執行失敗：', err);
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(1);
});
