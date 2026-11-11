/**
 * marketing 的 flow（AGENTS.md 結構規則 2）。marketing 模組其他路由還沒搬（#337），仍以舊寫法呼叫 service。
 */
import { flowOf } from '../../lib/tenant-ctx.js';
import { getBroadcastChannelId } from './marketing.service.js';

export const getBroadcastChannelIdFlow = flowOf(getBroadcastChannelId);
