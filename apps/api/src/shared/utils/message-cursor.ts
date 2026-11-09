/**
 * 訊息往前分頁的游標（change fix-chat-window-load-older-468，design D2）。
 *
 * `GET /contacts/:id/messages` 與 `GET /conversations/:id/messages` 共用：游標是最後一則的時間與 id，
 * 同一毫秒有多則時以 id 區分，不重複也不遺漏。`createdAt` 是 Prisma 預設的 timestamp(3)，與 toISOString() 同為毫秒精度。
 * 游標只帶時間與 id，不帶租戶或對話；查詢條件由呼叫端限定範圍。
 */
import { AppError } from './response.js';

export interface MessageCursor {
  createdAt: Date;
  id: string;
}

export function encodeMessageCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

export function decodeMessageCursor(cursor: string): MessageCursor | null {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const createdAt = new Date(iso ?? '');
  return id && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : null;
}

/** 解析 `before` 參數；沒帶時回 null，格式錯誤時回 400 */
export function parseMessageCursor(before: string | undefined): MessageCursor | null {
  if (!before) return null;
  const cursor = decodeMessageCursor(before);
  if (!cursor) throw new AppError('分頁參數格式錯誤', 'VALIDATION_ERROR', 400);
  return cursor;
}

/** 比游標更早的訊息；與 MESSAGE_NEWEST_FIRST 的排序搭配 */
export function olderThanCursor(cursor: MessageCursor | null) {
  return cursor
    ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }
    : {};
}

/** 由新到舊，同一時間再依 id，讓游標條件與排序一致 */
export const MESSAGE_NEWEST_FIRST = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
