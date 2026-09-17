/**
 * 綁定流程的業務邏輯：發起綁定、處理 LINE 回傳的 accountLink 事件。
 *
 * 綁定結果寫入 ContactAttribute（design D4：不新建表），
 * 與「會員編號對應」共用同一套機制。
 */
import type { PrismaClient } from '@prisma/client';
import { logger } from '@open333crm/core';
import { issueAccountLinkToken } from '@open333crm/channel-plugins/line';
import { withTenant } from '../../lib/tenant-db.js';
import {
  generateNonce,
  storeNonce,
  consumeNonce,
  buildAccountLinkUrl,
} from './account-link.service.js';

/** ContactAttribute 的 key：標記此聯絡人已完成 LINE 身分驗證。 */
export const LINE_VERIFIED_KEY = 'line_account_linked_at';

export type BindingFailure =
  | 'NONCE_NOT_FOUND'
  | 'NONCE_EXPIRED'
  | 'VERIFICATION_FAILED'
  | 'CONTACT_NOT_FOUND';

/**
 * 發起綁定：向 LINE 取得 linkToken，配一組 nonce，回傳可點擊的連動網址。
 *
 * linkToken 由 LINE 簽發並綁定該 lineUid，效期由 LINE 決定（官方為 10 分鐘
 * 但註明可能變動），故此處不自行判斷過期——過期時 LINE 會在頁面提示，
 * 且不會送出 webhook。
 */
export async function startBinding(
  prisma: PrismaClient,
  params: {
    tenantId: string;
    contactId: string;
    channelId: string;
    lineUid: string;
    channelAccessToken: string;
  },
): Promise<{ url: string; nonce: string }> {
  const linkToken = await issueAccountLinkToken(params.channelAccessToken, params.lineUid);

  const nonce = generateNonce();
  await storeNonce(nonce, {
    tenantId: params.tenantId,
    contactId: params.contactId,
    channelId: params.channelId,
    lineUid: params.lineUid,
    createdAt: Date.now(),
  });

  logger.info('[AccountLink] 已發起綁定', {
    tenantId: params.tenantId,
    contactId: params.contactId,
    // nonce 只記前綴，完整值等同可用憑證
    noncePrefix: nonce.slice(0, 8),
  });

  return { url: buildAccountLinkUrl(linkToken, nonce), nonce };
}

/**
 * 處理 LINE 送回的 accountLink 事件。
 *
 * result === 'ok'   → LINE 已驗證身分，寫入標記並回 contactId 供簽發 fan token
 * result === 'failed' → 驗證失敗，不寫入任何資料，僅記錄供稽核
 *
 * 失敗原因需分類回報（4a.7）：nonce 查無與驗證失敗是不同問題，
 * 前者多為過期或重複使用，後者代表 LINE 端驗不過。
 */
export async function completeBinding(
  prisma: PrismaClient,
  params: { nonce: string; result: string; lineUid?: string },
): Promise<
  | { ok: true; tenantId: string; contactId: string }
  | { ok: false; reason: BindingFailure }
> {
  // 先消費 nonce：無論成敗都不該留著被重放
  const payload = await consumeNonce(params.nonce);

  if (!payload) {
    logger.warn('[AccountLink] nonce 查無或已使用', {
      noncePrefix: params.nonce.slice(0, 8),
      result: params.result,
    });
    return { ok: false, reason: 'NONCE_NOT_FOUND' };
  }

  if (params.result !== 'ok') {
    // LINE 判定驗證失敗——可能是使用者非 token 的發放對象
    logger.warn('[AccountLink] LINE 回報驗證失敗', {
      tenantId: payload.tenantId,
      contactId: payload.contactId,
      result: params.result,
    });
    return { ok: false, reason: 'VERIFICATION_FAILED' };
  }

  // 防護：LINE 回傳的 uid 應與發起時一致。不一致代表事件與 nonce 對不上，
  // 寧可拒絕也不要綁錯人——綁錯會讓 A 看到並使用 B 的券。
  if (params.lineUid && params.lineUid !== payload.lineUid) {
    logger.error('[AccountLink] 事件 uid 與發起時不符，拒絕綁定', {
      tenantId: payload.tenantId,
      contactId: payload.contactId,
    });
    return { ok: false, reason: 'VERIFICATION_FAILED' };
  }

  const bound = await withTenant(prisma, payload.tenantId, async (tx) => {
    const contact = await tx.contact.findFirst({
      where: { id: payload.contactId, tenantId: payload.tenantId },
      select: { id: true },
    });
    if (!contact) return false;

    await tx.contactAttribute.upsert({
      where: { contactId_key: { contactId: payload.contactId, key: LINE_VERIFIED_KEY } },
      create: {
        contactId: payload.contactId,
        key: LINE_VERIFIED_KEY,
        value: new Date().toISOString(),
        dataType: 'string',
      },
      update: { value: new Date().toISOString() },
    });
    return true;
  });

  if (!bound) return { ok: false, reason: 'CONTACT_NOT_FOUND' };

  logger.info('[AccountLink] 綁定完成', {
    tenantId: payload.tenantId,
    contactId: payload.contactId,
  });

  return { ok: true, tenantId: payload.tenantId, contactId: payload.contactId };
}

/** 查詢此聯絡人是否已完成身分驗證。券夾等端點據此判斷可否存取。 */
export async function isVerified(
  prisma: PrismaClient,
  tenantId: string,
  contactId: string,
): Promise<boolean> {
  return withTenant(prisma, tenantId, async (tx) => {
    const attr = await tx.contactAttribute.findUnique({
      where: { contactId_key: { contactId, key: LINE_VERIFIED_KEY } },
      select: { value: true },
    });
    return attr != null;
  });
}
