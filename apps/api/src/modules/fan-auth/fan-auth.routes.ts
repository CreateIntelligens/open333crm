/**
 * 顧客端身分驗證 API。Prefix: /api/v1/fan/binding
 *
 * 這些端點在顧客尚未有身分時呼叫，故**不能要求 fan token**。
 * 安全性由 LINE Account Link 保證（design D11）：
 * - 發起綁定需持有效的 lineUid，且 linkToken 由 LINE 簽發並綁定該 uid
 * - LINE 平台驗證開啟連結者即為 token 發放對象，失敗不送 ok 事件
 * - nonce 與票據皆為一次性、短效
 */
import type { FastifyInstance } from 'fastify';
import { logger } from '@open333crm/core';
import { decryptCredentials } from '../channel/channel.service.js';
import { withTenant } from '../../lib/tenant-db.js';
import { startBinding } from './fan-binding.service.js';
import { takeBindingTicket, takeBindingFailure } from './binding-ticket-store.js';

/** 綁定失敗原因對顧客的說明。技術細節留在 log，不外露。 */
const FAILURE_MESSAGES: Record<string, string> = {
  NONCE_NOT_FOUND: '連結已失效，請重新點選領取',
  NONCE_EXPIRED: '連結已過期，請重新點選領取',
  VERIFICATION_FAILED: '身分驗證未通過，請重新操作',
  CONTACT_NOT_FOUND: '查無此帳號，請聯繫客服',
};

export default async function fanAuthRoutes(app: FastifyInstance) {
  /**
   * 發起綁定。由對話中的「領取優惠券」動作觸發，回傳可點擊的 LINE 連動網址。
   *
   * ⚠️ 需帶 channelId 與 lineUid —— 兩者皆來自系統既有的對話脈絡，
   * 不接受顧客端任意指定 contactId（那正是舊 /auth 的漏洞）。
   */
  app.post('/start', async (request, reply) => {
    const body = request.body as {
      tenantId?: string;
      channelId?: string;
      contactId?: string;
      lineUid?: string;
    };
    const { tenantId, channelId, contactId, lineUid } = body;
    if (!tenantId || !channelId || !contactId || !lineUid) {
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: '缺少必要參數' },
      });
    }

    // 驗證這組 channel／contact／uid 確實屬於同一租戶且彼此對應，
    // 否則可拿他人 contactId 配自己的 lineUid 完成綁定
    const valid = await withTenant(app.prisma, tenantId, async (tx) => {
      const identity = await tx.channelIdentity.findFirst({
        where: { channelId, uid: lineUid, contactId },
        select: { id: true },
      });
      return identity != null;
    });
    if (!valid) {
      logger.warn('[FanAuth] 綁定參數不對應', { tenantId, channelId });
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: '參數不正確' },
      });
    }

    const channel = await withTenant(app.prisma, tenantId, (tx) =>
      tx.channel.findFirst({ where: { id: channelId, tenantId }, select: { credentialsEncrypted: true } }));
    if (!channel) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: '查無此渠道' },
      });
    }

    try {
      const credentials = decryptCredentials(channel.credentialsEncrypted);
      const result = await startBinding(app.prisma, {
        tenantId,
        contactId,
        channelId,
        lineUid,
        channelAccessToken: credentials.channelAccessToken as string,
      });
      return { success: true, data: { url: result.url, nonce: result.nonce } };
    } catch (err) {
      logger.error('[FanAuth] 發起綁定失敗', { tenantId, error: (err as Error).message });
      return reply.status(502).send({
        success: false,
        error: { code: 'LINE_API_ERROR', message: '無法建立綁定連結，請稍後再試' },
      });
    }
  });

  /**
   * 顧客端輪詢綁定結果。
   *
   * 為何用輪詢：LINE 把結果送到 webhook（伺服器對伺服器），
   * 顧客的瀏覽器收不到。以 nonce 為鍵取回票據——nonce 本來就在顧客手上的連結裡。
   */
  app.get('/result/:nonce', async (request, reply) => {
    const { nonce } = request.params as { nonce: string };

    const failure = await takeBindingFailure(nonce);
    if (failure) {
      return reply.status(401).send({
        success: false,
        error: {
          code: failure,
          message: FAILURE_MESSAGES[failure] ?? '綁定未完成，請重新操作',
        },
      });
    }

    const ticket = await takeBindingTicket(nonce);
    if (!ticket) {
      // 尚未完成不是錯誤——顧客可能還停在 LINE 的確認畫面
      return { success: true, data: { status: 'pending' } };
    }

    return { success: true, data: { status: 'ready', ticket } };
  });
}
