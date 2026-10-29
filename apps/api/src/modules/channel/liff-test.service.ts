/**
 * 測試 LIFF 設定的資料存取（change add-liff-config-test）。只收 TenantCtx，不呼叫外部服務。
 */
import { couponLiffConfig, type CouponLiffConfig } from '@open333crm/core';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { patchChannelSettings } from './channel.service.js';

export type LiffTestTarget = { kind: 'ready'; liff: CouponLiffConfig } | { kind: 'not_found' } | { kind: 'not_configured' };

/** 渠道存檔的 LIFF 設定。不是 LINE 渠道，或 LIFF App ID 與 Login Channel ID 沒有都填，算沒有設定 */
export async function readLiffTestTarget(ctx: TenantCtx, channelId: string): Promise<LiffTestTarget> {
  const { tx, tenantId } = ctx;
  const line = await tx.channel.findFirst({
    where: { id: channelId, tenantId, channelType: 'LINE' },
    select: { settings: true },
  });
  if (!line) {
    const exists = await tx.channel.count({ where: { id: channelId, tenantId } });
    return { kind: exists ? 'not_configured' : 'not_found' };
  }
  const liff = couponLiffConfig(line.settings);
  return liff ? { kind: 'ready', liff } : { kind: 'not_configured' };
}

/** uid 是不是這個渠道已有的 LINE 身分（design D3：Provider 不同時 userId 不同，顧客開券時會對不上） */
export async function isLineIdentityOfChannel(ctx: TenantCtx, channelId: string, uid: string): Promise<boolean> {
  const { tx, tenantId } = ctx;
  const found = await tx.channelIdentity.findFirst({
    where: { channelId, uid, contact: { tenantId } },
    select: { id: true },
  });
  return found !== null;
}

export interface LiffTestRecord {
  verifiedAt: string;
  liffId: string;
  loginChannelId: string;
}

/** 測試成功的紀錄寫進 settings.liffTest（系統維護欄位，design D6） */
export async function recordLiffTestSuccess(ctx: TenantCtx, channelId: string, record: LiffTestRecord): Promise<void> {
  await patchChannelSettings(ctx.tx, channelId, ctx.tenantId, { liffTest: record });
}
