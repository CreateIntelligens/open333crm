import { linePlugin, fbPlugin, threadsPlugin } from '@open333crm/channel-plugins';
import type { ChannelPlugin } from '@open333crm/channel-plugins';

/**
 * workers 送訊息用的渠道外掛清單（不讀 API 的共用 registry，兩邊要各自註冊）。
 * 規則在沒有外掛的渠道會記成送出失敗。API 依 `AUTOMATION_DELIVERY_CHANNEL_TYPES` 判斷規則能否回覆，
 * 加外掛時那份清單也要一起改（測試會檢查兩邊一致）。
 */
export function createWorkerPluginRegistry(): Map<string, ChannelPlugin> {
  const registry = new Map<string, ChannelPlugin>();
  for (const plugin of [linePlugin, fbPlugin, threadsPlugin]) registry.set(plugin.channelType, plugin);
  return registry;
}
