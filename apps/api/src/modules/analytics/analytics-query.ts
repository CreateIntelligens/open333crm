/**
 * 報表的查詢參數。報表頁（analytics.routes.ts）與 CLI（cli/cli.routes.ts）共用，
 * 兩者都依主規格 analytics-reports 擋下起始日晚於結束日的區間。
 */
import { z } from 'zod/v3';

export const dateRangeFields = z.object({
  from: z.coerce.date().default(() => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
  to: z.coerce.date().default(() => new Date()),
});

/** 起始日晚於結束日時擋下：原本會回傳全 0 報表，使用者以為沒有資料 */
export function ordered<T extends z.ZodTypeAny>(schema: T) {
  return schema.refine((d: { from: Date; to: Date }) => d.from <= d.to, {
    path: ['from'],
    message: '起始日不可晚於結束日',
  });
}

export const dateRangeSchema = ordered(dateRangeFields);

export const messageTrendSchema = ordered(
  dateRangeFields.extend({
    groupBy: z.enum(['day', 'week', 'month']).default('day'),
  }),
);
