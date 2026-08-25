// 平台後台顯示用格式化。costUsd 從後端來是 Decimal 序列化的字串，只顯示不加總。

const numFmt = new Intl.NumberFormat('en-US');

export function fmtNum(n: number | bigint): string {
  return numFmt.format(n);
}

/** token 數：大數字用 k/M 縮寫，小數字顯示原值 */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return numFmt.format(n);
}

/** 成本：接受 Decimal 字串，顯示 USD（小額到 4 位小數） */
export function fmtUsd(cost: string | number): string {
  const n = typeof cost === 'string' ? Number(cost) : cost;
  if (!isFinite(n)) return '$0';
  // 小於 1 分顯示更多位數，否則 2 位
  const digits = n > 0 && n < 0.01 ? 4 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}
