/**
 * 會員綁定：查詢外部會員系統 → 寫入 ContactAttribute → 貼標。
 *
 * 沿用 ContactAttribute（design D4），不新建表——它已有
 * key/value/dataType 與 @@unique([contactId, key])，足以承載會員編號對應。
 *
 * 函式收 TenantCtx。查詢外部會員系統不在交易內，由 member-binding.flow.ts 串接（AGENTS.md 結構規則 2）。
 */
import type { Prisma } from '@prisma/client';
import { logger } from '@open333crm/core';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { encryptCredentials, decryptCredentials } from '../channel/channel.service.js';
import { addTagToTarget } from '../tag/tagging.service.js';
import type {
  MemberBindingConfig,
  BindingResult,
  BindingSuccess,
} from './member-binding.types.js';

/** 預設的會員編號 attribute key。 */
const DEFAULT_ATTRIBUTE_KEY = 'member_id';

/**
 * 設定存於 TenantSettings.memberBinding（JSON 欄位）。
 *
 * ⚠️ 認證憑證是客戶的 API 金鑰，**加密後才入庫**（沿用 channel 的 AES-256-GCM），
 * 與其他渠道憑證一致。DB 被讀走時不應直接拿到可用的金鑰。
 */
type StoredConfig = Omit<MemberBindingConfig, 'auth'> & {
  auth?: { type: MemberBindingConfig['auth']['type']; headerName?: string; credentialEnc?: string };
};

export async function getBindingConfig(ctx: TenantCtx): Promise<MemberBindingConfig | null> {
  const { tenantId } = ctx;
  const settings = await ctx.tx.tenantSettings.findUnique({ where: { tenantId }, select: { memberBinding: true } });
  const stored = settings?.memberBinding as StoredConfig | undefined;
  // 空物件（欄位預設值）視為未設定
  if (!stored || Object.keys(stored).length === 0) return null;

  let credential: string | undefined;
  if (stored.auth?.credentialEnc) {
    try {
      credential = decryptCredentials(stored.auth.credentialEnc).value as string;
    } catch (err) {
      // 金鑰輪替或資料損毀：視為未設定憑證，讓呼叫端得到明確的認證失敗，
      // 而不是拿著壞掉的字串去打對方 API
      logger.error('[MemberBinding] 憑證解密失敗', { tenantId, error: (err as Error).message });
    }
  }

  return {
    ...(stored as unknown as MemberBindingConfig),
    auth: {
      type: stored.auth?.type ?? 'none',
      headerName: stored.auth?.headerName,
      credential,
    },
  };
}

export async function saveBindingConfig(ctx: TenantCtx, config: MemberBindingConfig): Promise<void> {
  const { tenantId } = ctx;
  const { auth, ...rest } = config;
  const stored: StoredConfig = {
    ...rest,
    auth: {
      type: auth?.type ?? 'none',
      headerName: auth?.headerName,
      credentialEnc: auth?.credential ? encryptCredentials({ value: auth.credential }) : undefined,
    },
  };

  await ctx.tx.tenantSettings.upsert({
    where: { tenantId },
    create: { tenantId, memberBinding: stored as unknown as Prisma.InputJsonValue },
    update: { memberBinding: stored as unknown as Prisma.InputJsonValue },
  });
}

/**
 * 寫入綁定（外部會員系統已回傳會員編號之後）。
 *
 * ⚠️ 只有在完整取得會員編號後才寫入——不建立不完整綁定（tasks 5.6）。
 * 綁到一半的資料比沒綁更糟：顧客以為綁好了，實際查不到權益。
 */
export async function writeBinding(
  ctx: TenantCtx,
  config: MemberBindingConfig,
  contactId: string,
  lookup: BindingSuccess,
): Promise<BindingResult> {
  const { tx, tenantId } = ctx;
  const attributeKey = config.attributeKey || DEFAULT_ATTRIBUTE_KEY;

  // 同一個會員編號的綁定依序處理：先查再寫之間沒有鎖的話，兩人同時綁都查不到對方、都會成功
  const lockKey = `member-binding:${tenantId}:${lookup.memberId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
  // 同一會員編號不可綁到多個聯絡人——否則兩人共享同一會員權益
  const conflicting = await tx.contactAttribute.findFirst({
    where: {
      key: attributeKey,
      value: lookup.memberId,
      contactId: { not: contactId },
      contact: { tenantId },
    },
    select: { contactId: true },
  });
  if (conflicting) {
    logger.warn('[MemberBinding] 會員編號已綁定其他聯絡人', {
      tenantId,
      memberId: lookup.memberId,
    });
    return { ok: false as const, reason: 'ALREADY_BOUND_TO_OTHER' as const };
  }

  // 會員編號與其他對應欄位一併寫入
  for (const [key, value] of Object.entries(lookup.attributes)) {
    const attrKey = key === 'memberId' ? attributeKey : `member_${key}`;
    await tx.contactAttribute.upsert({
      where: { contactId_key: { contactId, key: attrKey } },
      create: { contactId, key: attrKey, value, dataType: 'string' },
      update: { value },
    });
  }

  if (config.bindTagId) {
    try {
      await addTagToTarget(tx, {
        tenantId,
        targetType: 'CONTACT',
        targetId: contactId,
        tagId: config.bindTagId,
        addedBy: 'system',
      });
    } catch (err) {
      // 貼標失敗不影響綁定——綁定本身已成功，標籤是行銷輔助
      logger.warn('[MemberBinding] 綁定貼標失敗（不影響綁定）', {
        tenantId,
        error: (err as Error).message,
      });
    }
  }

  logger.info('[MemberBinding] 綁定成功', { tenantId, contactId });
  return lookup;
}

/** 查詢此聯絡人的綁定狀態。 */
export async function getBinding(ctx: TenantCtx, contactId: string): Promise<{ bound: boolean; memberId?: string }> {
  const config = await getBindingConfig(ctx);
  const attributeKey = config?.attributeKey || DEFAULT_ATTRIBUTE_KEY;

  const attr = await ctx.tx.contactAttribute.findFirst({
    where: { contactId, key: attributeKey, contact: { tenantId: ctx.tenantId } },
    select: { value: true },
  });

  return attr ? { bound: true, memberId: attr.value } : { bound: false };
}

/** 解除綁定。刪除會員相關 attribute，保留其他欄位。 */
export async function unbindMember(ctx: TenantCtx, contactId: string): Promise<{ removed: number }> {
  const config = await getBindingConfig(ctx);
  const attributeKey = config?.attributeKey || DEFAULT_ATTRIBUTE_KEY;

  const result = await ctx.tx.contactAttribute.deleteMany({
    where: {
      contactId,
      OR: [{ key: attributeKey }, { key: { startsWith: 'member_' } }],
      contact: { tenantId: ctx.tenantId },
    },
  });
  return { removed: result.count };
}
