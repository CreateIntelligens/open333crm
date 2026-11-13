/**
 * 留言接收的補訂閱腳本（change add-comment-keyword-private-reply design「上線與回滾」、D19）。
 *
 * `POST subscribed_apps` 是整份取代：少帶一個 messaging 欄位就是那個粉專的私訊全部中斷。所以這支腳本
 * 永遠送完整欄位（私訊欄位＋留言欄位），並在寫入前後各 GET 一次訂閱欄位印出對照。
 *
 * 安全設計：
 *   - 預設 --dry-run：只查詢目前的訂閱並列出會送出的欄位；帶 --apply 才寫入
 *   - 單一渠道失敗只記錄、不中斷；權杖、appsecret_proof 不輸出
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
 * TODO(add-comment-keyword-private-reply 7.7)：meta-connect.service 的 subscribedFieldsFor() 合併後改用它，欄位清單只留一份。
 */
import { prisma } from '@open333crm/database';
import { fbPlugin, threadsPlugin, type ChannelPlugin } from '@open333crm/channel-plugins';
import { decryptCredentials } from '../modules/channel/channel.service.js';
import { getMetaAppConfig, SUBSCRIBED_FIELDS } from '../modules/meta-connect/meta-connect.service.js';

// 跨租戶掃描（平台維運腳本）：DATABASE_URL 需指向 owner／app_admin（BYPASSRLS）
const prismaAdmin = prisma;

type Mode = 'enable' | 'disable' | 'resubscribe';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const mode = (arg('--mode') ?? 'resubscribe') as Mode;
const apply = process.argv.includes('--apply');
const tenantId = arg('--tenant');
const channelId = arg('--channel');

/** IG（Instagram Login）在用的私訊欄位 */
const IG_BASE_FIELDS = ['messages'];

/** 渠道應訂的完整欄位：私訊欄位一律保留，接收留言時加上留言欄位 */
export function commentReplySubscriptionFields(channelType: string, receiving: boolean): string[] {
  if (channelType === 'FB') return receiving ? [...SUBSCRIBED_FIELDS, 'feed'] : [...SUBSCRIBED_FIELDS];
  return receiving ? [...IG_BASE_FIELDS, 'comments'] : [...IG_BASE_FIELDS];
}

/** 目前的訂閱欄位（查不到回 null）；FB 用 /{page-id}/subscribed_apps，IG 用 /me/subscribed_apps */
async function currentFields(channelType: string, accountId: string, token: string): Promise<string[] | null> {
  const url =
    channelType === 'FB'
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
  const plugins: Record<string, ChannelPlugin> = { FB: fbPlugin, THREADS: threadsPlugin };
  const channels = await prismaAdmin.channel.findMany({
    where: {
      isActive: true,
      channelType: { in: ['FB', 'THREADS'] as never },
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
      const credentials = decryptCredentials(ch.credentialsEncrypted);
      const token = String(credentials.pageAccessToken ?? '');
      const settings = (ch.settings ?? {}) as Record<string, any>;
      const receiving = mode === 'enable' ? true : mode === 'disable' ? false : settings.commentReply?.receiving === true;
      const fields = commentReplySubscriptionFields(ch.channelType, receiving);
      const before = await currentFields(ch.channelType, ch.externalAccountId!, token);
      console.log(`${label}\n  目前：${before ? before.join(',') : '（查不到）'}\n  送出：${fields.join(',')}`);
      if (!apply) continue;
      const ext = plugins[ch.channelType]?.extensions?.comments;
      if (!ext) throw new Error('外掛沒有留言擴充');
      const platformApp = credentials.connectMode === 'platform' ? getMetaAppConfig() : null;
      await ext.subscribeFields(credentials, {
        accountId: ch.externalAccountId!,
        fields,
        ...(platformApp ? { appSecret: platformApp.appSecret } : {}),
      });
      const now = new Date().toISOString();
      const commentReply = { ...(settings.commentReply ?? {}), receiving, ...(receiving ? { subscribedAt: now } : {}) };
      await prismaAdmin.channel.updateMany({
        where: { id: ch.id, tenantId: ch.tenantId },
        data: { settings: { ...settings, commentReply } },
      });
      const after = await currentFields(ch.channelType, ch.externalAccountId!, token);
      console.log(`  寫入後：${after ? after.join(',') : '（查不到）'}`);
      ok += 1;
    } catch (err) {
      failed += 1;
      console.error(`${label}\n  失敗：${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`完成：成功 ${ok}、失敗 ${failed}${apply ? '' : '（dry-run 沒有寫入）'}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prismaAdmin.$disconnect());
