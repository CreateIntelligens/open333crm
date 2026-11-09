/**
 * 對話模組的 flow（AGENTS.md 結構規則 2）。
 *
 * 讀訊息只呼叫一個 service 函式，沒有副作用（change fix-chat-window-load-older-468）。
 */
import { flowOf } from '../../lib/tenant-ctx.js';
import { getMessages } from './conversation.service.js';

export const getMessagesFlow = flowOf(getMessages);
