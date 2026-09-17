/**
 * 會員綁定：查詢外部會員系統 → 寫入 ContactAttribute → 貼標。
 *
 * 沿用 ContactAttribute（design D4），不新建表——它已有
 * key/value/dataType 與 @@unique([contactId, key])，足以承載會員編號對應。
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { logger } from '@open333crm/core';
import { withTenant } from '../../lib/tenant-db.js';
import { encryptCredentials, decryptCredentials } from '../channel/channel.service.js';
import { addTagToTarget } from '../tag/tagging.service.js';
import { lookupMember } from './member-lookup.service.js';
import type {
  MemberBindingConfig,
  MemberLookupInput,
  BindingResult,
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

export async function getBindingConfig(
  prisma: PrismaClient,
  tenantId: string,
): Promise<MemberBindingConfig | null> {
  const settings = await withTenant(prisma, tenantId, (tx) =>
    tx.tenantSettings.findUnique({ where: { tenantId }, select: { memberBinding: true } }));
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

export async function saveBindingConfig(
  prisma: PrismaClient,
  tenantId: string,
  config: MemberBindingConfig,
): Promise<void> {
  const { auth, ...rest } = config;
  const stored: StoredConfig = {
    ...rest,
    auth: {
      type: auth?.type ?? 'none',
      headerName: auth?.headerName,
      credentialEnc: auth?.credential ? encryptCredentials({ value: auth.credential }) : undefined,
    },
  };

  await withTenant(prisma, tenantId, (tx) =>
    tx.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, memberBinding: stored as unknown as Prisma.InputJsonValue },
      update: { memberBinding: stored as unknown as Prisma.InputJsonValue },
    }));
}

/**
 * 執行綁定。
 *
 * ⚠️ 只有在完整取得會員編號後才寫入——不建立不完整綁定（tasks 5.6）。
 * 綁到一半的資料比沒綁更糟：顧客以為綁好了，實際查不到權益。
 */
export async function bindMember(
  prisma: PrismaClient,
  tenantId: string,
  contactId: string,
  input: MemberLookupInput,
): Promise<BindingResult> {
  const config = await getBindingConfig(prisma, tenantId);
  if (!config?.enabled) {
    return { ok: false, reason: 'NOT_CONFIGURED' };
  }

  const lookup = await lookupMember(config, input);
  if (!lookup.ok) return lookup;

  const attributeKey = config.attributeKey || DEFAULT_ATTRIBUTE_KEY;

  return withTenant(prisma, tenantId, async (tx) => {
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
  });
}

/** 查詢此聯絡人的綁定狀態。 */
export async function getBinding(
  prisma: PrismaClient,
  tenantId: string,
  contactId: string,
): Promise<{ bound: boolean; memberId?: string }> {
  const config = await getBindingConfig(prisma, tenantId);
  const attributeKey = config?.attributeKey || DEFAULT_ATTRIBUTE_KEY;

  const attr = await withTenant(prisma, tenantId, (tx) =>
    tx.contactAttribute.findUnique({
      where: { contactId_key: { contactId, key: attributeKey } },
      select: { value: true },
    }));

  return attr ? { bound: true, memberId: attr.value } : { bound: false };
}

/** 解除綁定。刪除會員相關 attribute，保留其他欄位。 */
export async function unbindMember(
  prisma: PrismaClient,
  tenantId: string,
  contactId: string,
): Promise<{ removed: number }> {
  const config = await getBindingConfig(prisma, tenantId);
  const attributeKey = config?.attributeKey || DEFAULT_ATTRIBUTE_KEY;

  return withTenant(prisma, tenantId, async (tx) => {
    const result = await tx.contactAttribute.deleteMany({
      where: {
        contactId,
        OR: [{ key: attributeKey }, { key: { startsWith: 'member_' } }],
        contact: { tenantId },
      },
    });
    return { removed: result.count };
  });
}
