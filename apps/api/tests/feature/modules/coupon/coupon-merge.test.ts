/**
 * 合併聯絡人時券與歸戶驗證跟著移動（add-coupon-system「合併聯絡人時券跟著移到保留方」）。
 * 每個案例在交易內執行並 rollback，不留資料。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { withTenant, type TenantDb } from '#src/lib/tenant-db.js';
import { TENANT_A } from '#tests/setup/feature-config.js';
import { mergeContacts, revertMerge } from '#src/modules/contact/contact-merge.service.js';

const prisma = new PrismaClient();
const T = TENANT_A;
class Rollback extends Error {}

interface Fixture {
  tx: TenantDb;
  fbContact: string;
  lineContact: string;
  instanceId: string;
}

async function setup(tx: TenantDb, opts: { fbVerified?: boolean } = {}): Promise<Fixture> {
  const tag = `coupon-merge-${Date.now()}`;
  const mkChannel = (channelType: 'LINE' | 'FB') =>
    tx.channel.create({ data: { tenantId: T, channelType, displayName: `${tag}-${channelType}`, credentialsEncrypted: 'x', isActive: true } });
  const [line, fb] = await Promise.all([mkChannel('LINE'), mkChannel('FB')]);
  const mkContact = async (name: string, ch: { id: string; channelType: string }, verified: boolean) => {
    const c = await tx.contact.create({
      data: {
        tenantId: T,
        displayName: `${tag}-${name}`,
        ...(verified ? { identityVerifiedAt: new Date('2026-10-01T00:00:00Z'), identityVerifiedVia: 'phone' } : {}),
      },
    });
    await tx.channelIdentity.create({
      data: { contactId: c.id, channelId: ch.id, channelType: ch.channelType as never, uid: `${tag}-${name}` },
    });
    return c.id;
  };
  const fbContact = await mkContact('FB', fb, opts.fbVerified ?? false);
  const lineContact = await mkContact('LINE', line, false);
  const coupon = await tx.coupon.create({
    data: { tenantId: T, name: `${tag} 券`, displayCode: `CP-M${Date.now().toString(36).slice(-5).toUpperCase()}`, createdById: T },
  });
  const instance = await tx.couponInstance.create({
    data: { tenantId: T, couponId: coupon.id, contactId: fbContact, code: `${tag}-CODE`, status: 'CLAIMED', claimedAt: new Date() },
  });
  return { tx, fbContact, lineContact, instanceId: instance.id };
}

function scenario(name: string, opts: { fbVerified?: boolean }, fn: (f: Fixture) => Promise<void>) {
  test(name, async () => {
    try {
      await withTenant(prisma, T, async (tx) => {
        await fn(await setup(tx, opts));
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  });
}

afterAll(() => prisma.$disconnect());

const merge = (f: Fixture) =>
  mergeContacts({ tx: f.tx, tenantId: T }, { survivorId: f.lineContact, mergedId: f.fbContact, source: 'PHONE' });

scenario('合併後券在保留方的券夾', {}, async (f) => {
  await merge(f);
  const instance = await f.tx.couponInstance.findFirst({ where: { id: f.instanceId } });
  assert.equal(instance?.contactId, f.lineContact);
});

scenario('合併時帶入歸戶驗證', { fbVerified: true }, async (f) => {
  await merge(f);
  const survivor = await f.tx.contact.findFirst({ where: { id: f.lineContact } });
  assert.equal(survivor?.identityVerifiedVia, 'phone');
  assert.ok(survivor?.identityVerifiedAt instanceof Date);
});

scenario('解除合併時券回到原聯絡人', { fbVerified: true }, async (f) => {
  const { mergeLogId } = await merge(f);
  await revertMerge({ tx: f.tx, tenantId: T }, { mergeLogId, revertedBy: 'customer' });
  const instance = await f.tx.couponInstance.findFirst({ where: { id: f.instanceId } });
  assert.equal(instance?.contactId, f.fbContact);
  const survivor = await f.tx.contact.findFirst({ where: { id: f.lineContact } });
  assert.equal(survivor?.identityVerifiedAt, null);
});
