/** 取出 FB／IG referral 物件的 ref 字串；沒有或空字串回 undefined（FB、IG plugin 共用） */
export function refOf(referral: unknown): string | undefined {
  const ref = (referral as { ref?: unknown } | undefined)?.ref;
  return typeof ref === 'string' && ref.trim() !== '' ? ref.trim() : undefined;
}
