/**
 * Partner API Key service
 *
 * Long-lived API keys for external partners to call /knowledge/partner-ingest
 * without managing JWT refresh. Stored as bcrypt hash; raw key shown only on
 * creation. List view shows prefix + last 4 chars for identification.
 */

import { randomBytes } from 'node:crypto';
import type { PrismaClient, PartnerApiKey } from '@prisma/client';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { hashPassword, verifyPassword } from '../../shared/utils/password.js';
import { logger } from '@open333crm/core';
import { AppError } from '../../shared/utils/response.js';

const KEY_PREFIX = 'pk_';
const KEY_RANDOM_BYTES = 32; // → 64 hex chars
// keyPrefix col stores the leading visible identifier ("pk_" + first 5 hex);
// keySuffix col stores last 4 hex. Together: "pk_a1b2c…f9e0"

/** 新金鑰的明文與要存的欄位。由 generatePartnerApiKey() 在交易外產生 */
export interface GeneratedApiKey {
  /** Raw key — only shown once at creation. Never persisted. */
  rawKey: string;
  keyHash: string;
  keyPrefix: string;
  keySuffix: string;
}

export interface CreateApiKeyInput {
  createdById: string;
  name: string;
  expiresAt?: Date | null;
  key: GeneratedApiKey;
}

/**
 * 產生金鑰並以 bcrypt 雜湊。bcrypt 很吃 CPU，呼叫端在交易外執行（AGENTS.md 結構規則 2）。
 */
export async function generatePartnerApiKey(): Promise<GeneratedApiKey> {
  const random = randomBytes(KEY_RANDOM_BYTES).toString('hex');
  const rawKey = `${KEY_PREFIX}${random}`;
  return {
    rawKey,
    keyHash: await hashPassword(rawKey),
    // For display: "pk_xxxxx" (prefix + first 5 hex chars)
    keyPrefix: `${KEY_PREFIX}${random.slice(0, 5)}`,
    keySuffix: random.slice(-4),
  };
}

/** 寫入 generatePartnerApiKey() 產生的金鑰 */
export async function createPartnerApiKey(ctx: TenantCtx, input: CreateApiKeyInput): Promise<PartnerApiKey> {
  return ctx.tx.partnerApiKey.create({
    data: {
      tenantId: ctx.tenantId,
      createdById: input.createdById,
      name: input.name,
      keyHash: input.key.keyHash,
      keyPrefix: input.key.keyPrefix,
      keySuffix: input.key.keySuffix,
      expiresAt: input.expiresAt ?? null,
    },
  });
}

export async function listPartnerApiKeys(ctx: TenantCtx): Promise<PartnerApiKey[]> {
  return ctx.tx.partnerApiKey.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * 停用金鑰。回傳 true 代表這次停用；金鑰已經停用時回傳 false，不再更新，呼叫端也不寫稽核。
 * 金鑰不存在或屬於另一個租戶時回 404。
 */
export async function revokePartnerApiKey(ctx: TenantCtx, id: string): Promise<boolean> {
  const { count } = await ctx.tx.partnerApiKey.updateMany({
    where: { id, tenantId: ctx.tenantId, isActive: true },
    data: { isActive: false },
  });
  if (count === 1) return true;
  const exists = await ctx.tx.partnerApiKey.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true } });
  // 與原本 update() 找不到時 P2025 的回應相同（error-handler.plugin.ts）
  if (!exists) throw new AppError('找不到指定的資料，可能已被刪除', 'NOT_FOUND', 404);
  return false;
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
  // 驗證時還不知道租戶：auth.plugin 以 prismaAdmin（BYPASSRLS）依前綴查詢
  prisma: PrismaClient,
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
