/**
 * 大量序號明細改背景匯出（add-coupon-system design D22）。
 *
 * 明細超過上限時，API 先回 202，在背景產生 CSV 存 Redis 24 小時，完成後以站內通知告知匯出者；
 * 產生失敗也發通知（失敗不能只寫 log）。下載只允許匯出者本人與同租戶。
 */
import { randomBytes } from 'node:crypto';
import { logger } from '@open333crm/core';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import type { BindingStore } from '../identity-binding/binding-code.js';
import { exportInstancesCsv, type RunInTenant } from './coupon-stats.service.js';

/** 明細超過這個筆數改背景產生 */
export const EXPORT_SYNC_LIMIT = 5000;
/** 背景產生的檔案保留時間 */
export const EXPORT_FILE_TTL_MS = 24 * 60 * 60 * 1000;

const JOB_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const fileKey = (jobId: string) => `coupon:export:${jobId}`;

interface StoredExport {
  tenantId: string;
  agentId: string;
  fileName: string;
  csv: string;
}

export interface ExportNotice {
  tenantId: string;
  agentId: string;
  type: 'coupon_export_ready' | 'coupon_export_failed';
  title: string;
  body: string;
  clickUrl?: string;
}

export interface BackgroundExportDeps {
  store: BindingStore;
  /** 發站內通知（呼叫端以 inTenant＋recordExportNotice 實作） */
  notify: (notice: ExportNotice) => Promise<void>;
  /** 在租戶交易內執行（入口以 inTenant 實作）；每頁一個交易，避開 5 秒的交易時限 */
  runInTenant: RunInTenant;
  /** 測試用：產生前執行，可丟錯模擬失敗 */
  beforeGenerate?: () => Promise<void>;
}

/** 寫入站內通知，回傳寫入的通知；推播給匯出者由 flow 登記（coupon-export.flow.ts） */
export function recordExportNotice(ctx: TenantCtx, notice: ExportNotice) {
  return ctx.tx.notification.create({
    data: {
      tenantId: ctx.tenantId,
      agentId: notice.agentId,
      type: notice.type,
      title: notice.title,
      body: notice.body,
      clickUrl: notice.clickUrl,
    },
  });
}

export function countInstances(ctx: TenantCtx, couponId: string): Promise<number> {
  // 與匯出的內容一致：發送中的券不算
  return ctx.tx.couponInstance.count({ where: { couponId, tenantId: ctx.tenantId, deliveryPendingAt: null } });
}

/**
 * 開始背景匯出，立即回傳匯出編號；產生與通知在背景進行，回傳的 done 只給測試等待。
 */
export function startBackgroundExport(
  deps: BackgroundExportDeps,
  job: { tenantId: string; agentId: string; couponId: string; couponName: string; fileName: string },
): { jobId: string; done: Promise<void> } {
  const jobId = randomBytes(16).toString('base64url');
  const done = (async () => {
    try {
      await deps.beforeGenerate?.();
      const csv = await exportInstancesCsv(deps.runInTenant, job.couponId);
      const stored: StoredExport = { tenantId: job.tenantId, agentId: job.agentId, fileName: job.fileName, csv };
      await deps.store.set(fileKey(jobId), JSON.stringify(stored), 'PX', EXPORT_FILE_TTL_MS, 'NX');
      await deps.notify({
        tenantId: job.tenantId,
        agentId: job.agentId,
        type: 'coupon_export_ready',
        title: '序號明細已可下載',
        body: `「${job.couponName}」的序號明細已產生，24 小時內可下載。`,
        clickUrl: `/dashboard/marketing/coupons/${job.couponId}?export=${jobId}`,
      });
    } catch (err) {
      logger.error('[CouponExport] 背景匯出失敗', { tenantId: job.tenantId, couponId: job.couponId, error: (err as Error).message });
      await deps
        .notify({
          tenantId: job.tenantId,
          agentId: job.agentId,
          type: 'coupon_export_failed',
          title: '序號明細匯出失敗',
          body: `「${job.couponName}」的序號明細沒有產生，請回到優惠券頁重新匯出。`,
          clickUrl: `/dashboard/marketing/coupons/${job.couponId}`,
        })
        .catch((notifyErr: unknown) =>
          logger.error('[CouponExport] 匯出失敗通知也送不出', { error: (notifyErr as Error).message }));
    }
  })();
  return { jobId, done };
}

export type ExportFileResult =
  | { status: 'ok'; csv: string; fileName: string }
  /** 編號不存在、不是自己的 */
  | { status: 'not_found' }
  /** 超過 24 小時或還沒產生完 */
  | { status: 'expired' };

/**
 * 讀取背景匯出的檔案。過期與不存在無法區分（Redis 已刪除），格式正確但查無資料一律視為過期；
 * 屬於別人的編號回 not_found，不透露檔案存在。
 */
export async function readExportFile(
  store: BindingStore,
  jobId: string,
  who: { tenantId: string; agentId: string },
): Promise<ExportFileResult> {
  if (!JOB_PATTERN.test(jobId)) return { status: 'not_found' };
  const raw = await store.get(fileKey(jobId));
  if (!raw) return { status: 'expired' };
  const stored = JSON.parse(raw) as StoredExport;
  if (stored.tenantId !== who.tenantId || stored.agentId !== who.agentId) return { status: 'not_found' };
  return { status: 'ok', csv: stored.csv, fileName: stored.fileName };
}
