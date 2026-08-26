/**
 * Partner API Key service
 *
 * Long-lived API keys for external partners to call /knowledge/partner-ingest
 * without managing JWT refresh. Stored as bcrypt hash; raw key shown only on
 * creation. List view shows prefix + last 4 chars for identification.
 */

import { randomBytes } from 'node:crypto';
import type { PrismaClient, PartnerApiKey } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import { hashPassword, verifyPassword } from '../../shared/utils/password.js';
import { logger } from '@open333crm/core';

const KEY_PREFIX = 'pk_';
const KEY_RANDOM_BYTES = 32; // → 64 hex chars
// keyPrefix col stores the leading visible identifier ("pk_" + first 5 hex);
// keySuffix col stores last 4 hex. Together: "pk_a1b2c…f9e0"

export interface CreateApiKeyInput {
  tenantId: string;
  createdById: string;
  name: string;
  expiresAt?: Date | null;
}

export interface CreateApiKeyResult {
  /** Raw key — only shown once at creation. Never persisted. */
  key: string;
  apiKey: PartnerApiKey;
}

/**
 * Generate a new API key, hash + persist, return both the raw key (one-time)
 * and the row.
 */
export async function createPartnerApiKey(
  prisma: TenantDb,
  input: CreateApiKeyInput,
): Promise<CreateApiKeyResult> {
  const random = randomBytes(KEY_RANDOM_BYTES).toString('hex');
  const rawKey = `${KEY_PREFIX}${random}`;
  const keyHash = await hashPassword(rawKey);

  // For display: "pk_xxxxx" (prefix + first 5 hex chars)
  const keyPrefix = `${KEY_PREFIX}${random.slice(0, 5)}`;
  const keySuffix = random.slice(-4);

  const apiKey = await prisma.partnerApiKey.create({
    data: {
      tenantId: input.tenantId,
      createdById: input.createdById,
      name: input.name,
      keyHash,
      keyPrefix,
      keySuffix,
      expiresAt: input.expiresAt ?? null,
    },
  });

  return { key: rawKey, apiKey };
}

export async function listPartnerApiKeys(
  prisma: TenantDb,
  tenantId: string,
): Promise<PartnerApiKey[]> {
  return prisma.partnerApiKey.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function revokePartnerApiKey(
  prisma: TenantDb,
  tenantId: string,
  id: string,
): Promise<void> {
  await prisma.partnerApiKey.update({
    where: { id, tenantId },
    data: { isActive: false },
  });
}

export type VerifyResult =
  | { ok: true; apiKey: PartnerApiKey }
  | { ok: false; reason: string };

/**
 * Verify a raw key from request header.
 *
 * Approach: extract prefix to narrow candidates (so we only bcrypt.compare
 * against keys with matching prefix), then bcrypt-verify against each
 * candidate's hash. With prefix index this is O(1) DB lookup + tiny bcrypt
 * batch (almost always exactly 1 candidate).
 */
export async function verifyPartnerApiKey(
  prisma: TenantDb,
  rawKey: string,
): Promise<VerifyResult> {
  if (!rawKey.startsWith(KEY_PREFIX)) {
    return { ok: false, reason: 'Malformed API key' };
  }
  const random = rawKey.slice(KEY_PREFIX.length);
  if (random.length < 9) {
    return { ok: false, reason: 'Malformed API key' };
  }

  const keyPrefix = `${KEY_PREFIX}${random.slice(0, 5)}`;

  const candidates = await prisma.partnerApiKey.findMany({
    where: { keyPrefix, isActive: true },
  });

  for (const cand of candidates) {
    const matches = await verifyPassword(rawKey, cand.keyHash);
    if (!matches) continue;

    // Expiry check
    if (cand.expiresAt && cand.expiresAt.getTime() < Date.now()) {
      return { ok: false, reason: 'API key expired' };
    }

    // Touch lastUsedAt (fire-and-forget; don't block request on this)
    prisma.partnerApiKey
      .update({ where: { id: cand.id }, data: { lastUsedAt: new Date() } })
      .catch((err) =>
        logger.warn(`[PartnerApiKey] Failed to touch lastUsedAt for ${cand.id}: ${(err as Error).message}`),
      );

    return { ok: true, apiKey: cand };
  }

  return { ok: false, reason: 'Invalid API key' };
}
