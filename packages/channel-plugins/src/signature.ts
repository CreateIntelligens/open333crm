import { timingSafeEqual } from 'node:crypto';

/**
 * 以固定時間比較兩個簽章字串（AUDIT CHAN-03）。
 * timingSafeEqual 在長度不同時會拋出錯誤，所以先比長度；長度不同直接回傳 false。
 */
export function signaturesMatch(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
