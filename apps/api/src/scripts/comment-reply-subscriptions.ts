/**
 * 留言接收的補訂閱腳本（change add-comment-keyword-private-reply design「上線與回滾」、D19）。
 *
 * `POST subscribed_apps` 是整份取代：少帶一個 messaging 欄位就是那個粉專的私訊全部中斷。所以這支腳本
 * 永遠送完整欄位（私訊欄位＋留言欄位），並在寫入前後各 GET 一次訂閱欄位印出對照。
 *
 * 安全設計：
 *   - 預設 --dry-run：只查詢目前的訂閱並列出會送出的欄位；帶 --apply 才寫入
 *   - 單一渠道失敗只記錄、不中斷；有任何渠道失敗時結束碼為 1；權杖、appsecret_proof 不輸出
 *   - 只處理有 externalAccountId、啟用中的 FB／IG 渠道
 *
 * 用法（在 apps/api 目錄，DATABASE_URL 指向 owner 或 app_admin）：
 *   npx tsx src/scripts/comment-reply-subscriptions.ts --mode enable --channel <id>            # dry-run
 *   npx tsx src/scripts/comment-reply-subscriptions.ts --mode resubscribe --tenant <id> --apply
 *   npx tsx src/scripts/comment-reply-subscriptions.ts --mode disable --channel <id> --apply   # 回滾：只留私訊欄位
 *
 * --mode enable：訂留言欄位，settings.commentReply.receiving = true
 * --mode disable：拿掉留言欄位，receiving = false
 * --mode resubscribe：依渠道目前的 receiving 重送完整欄位（Meta 取消了 feed 訂閱時）
 *
 * 欄位清單只有一份：comment-reply-channel.service 的 commentSubscriptionFields()（與後台「開啟留言接收」相同）。
 * 渠道的差異經外掛的留言擴充（extensions.comments）取得，不依 channelType 分支（結構規則 5）。
 */
import { prisma } from '@open333crm/database';
import type { ChannelType } from '@prisma/client';
import { fbPlugin, registerChannelPlugin, threadsPlugin, type ChannelCommentExtension } from '@open333crm/channel-plugins';
import { decryptCredentials, patchChannelSettings } from '../modules/channel/channel.service.js';
import { getMetaAppConfig } from '../modules/meta-connect/meta-connect.service.js';
import { commentChannelTypes, commentExtensionOf } from '../modules/comment-reply/comment-reply-access.js';
import { commentSubscriptionFields } from '../modules/comment-reply/comment-reply-channel.service.js';
import { commentReplySettingsOf, nextCommentReplySettings } from '../modules/comment-reply/comment-reply-settings.js';

// 跨租戶掃描（平台維運腳本）：DATABASE_URL 需指向 owner／app_admin（BYPASSRLS）
const prismaAdmin = prisma;

// 腳本在 API 行程外執行，要自己註冊有留言擴充的外掛（與 apps/api/src/index.ts 相同的外掛）
registerChannelPlugin(fbPlugin);
registerChannelPlugin(threadsPlugin);

type Mode = 'enable' | 'disable' | 'resubscribe';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const mode = (arg('--mode') ?? 'resubscribe') as Mode;
const apply = process.argv.includes('--apply');
const tenantId = arg('--tenant');
const channelId = arg('--channel');

/**
 * 目前的訂閱欄位（查不到回 null），只用來印出寫入前後的對照。外掛的 getSubscriptionStatus() 只回傳是否訂閱、
 * 不回傳欄位清單，所以這裡直接查：FB（platform 'fb'）用 /{page-id}/subscribed_apps，IG 用 /me/subscribed_apps。
 */
async function currentFields(ext: ChannelCommentExtension, accountId: string, token: string): Promise<string[] | null> {
  const url =
    ext.capabilities.platform === 'fb'
      ? `https://graph.facebook.com/v21.0/${encodeURIComponent(accountId)}/subscribed_apps`
      : 'https://graph.instagram.com/v21.0/me/subscribed_apps';
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Array<{ subscribed_fields?: string[] }> };
    return body.data?.[0]?.subscribed_fields ?? [];
  } catch {
    return null;
  }
}

async function main() {
  if (!['enable', 'disable', 'resubscribe'].includes(mode)) throw new Error('--mode 只能是 enable、disable、resubscribe');
  if (!tenantId && !channelId) throw new Error('請指定 --tenant 或 --channel（不支援一次處理全部渠道）');
  const channels = await prismaAdmin.channel.findMany({
    where: {
      isActive: true,
      channelType: { in: commentChannelTypes() as ChannelType[] },
      externalAccountId: { not: null },
      ...(tenantId ? { tenantId } : {}),
      ...(channelId ? { id: channelId } : {}),
    },
    select: { id: true, tenantId: true, channelType: true, displayName: true, externalAccountId: true, credentialsEncrypted: true, settings: true },
  });
  console.log(`${apply ? '【寫入】' : '【dry-run】'}mode=${mode}，共 ${channels.length} 個渠道`);
  let ok = 0;
  let failed = 0;
  for (const ch of channels) {
    const label = `[${ch.channelType}] ${ch.displayName} (${ch.id}) tenant=${ch.tenantId}`;
    try {
      const ext = commentExtensionOf(ch.channelType);
      if (!ext) throw new Error('外掛沒有留言擴充');
      const credentials = decryptCredentials(ch.credentialsEncrypted);
      const token = String(credentials.pageAccessToken ?? '');
      const settings = (ch.settings ?? {}) as Record<string, any>;
      const receiving = mode === 'enable' ? true : mode === 'disable' ? false : commentReplySettingsOf(settings).receiving;
      const fields = commentSubscriptionFields({ ext }, receiving);
      const before = await currentFields(ext, ch.externalAccountId!, token);
      console.log(`${label}\n  目前：${before ? before.join(',') : '（查不到）'}\n  送出：${fields.join(',')}`);
      if (!apply) continue;
      const platformApp = credentials.connectMode === 'platform' ? getMetaAppConfig() : null;
      await ext.subscribeFields(credentials, {
        accountId: ch.externalAccountId!,
        fields,
        ...(platformApp ? { appSecret: platformApp.appSecret } : {}),
      });
      // 只取代 settings.commentReply（jsonb 合併），不覆寫這段期間其他程式寫入的子鍵
      await patchChannelSettings(prismaAdmin, ch.id, ch.tenantId, { commentReply: nextCommentReplySettings(settings, receiving, fields) });
      const after = await currentFields(ext, ch.externalAccountId!, token);
      console.log(`  寫入後：${after ? after.join(',') : '（查不到）'}`);
      ok += 1;
    } catch (err) {
      failed += 1;
      console.error(`${label}\n  失敗：${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`完成：成功 ${ok}、失敗 ${failed}${apply ? '' : '（dry-run 沒有寫入）'}`);
  // 單一渠道失敗不中斷，但整批結果要反映在結束碼，`--apply || exit 1` 之類的呼叫端才看得到
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prismaAdmin.$disconnect());
