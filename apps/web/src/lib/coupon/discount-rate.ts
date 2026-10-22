/**
 * 後端存「折掉幾 %」，台灣慣用「打幾折」：15 → 85 折、20 → 8 折、10 → 9 折。
 * 後台、收件匣發券面板、顧客端與核銷台共用，確保同一張券到處顯示相同的折數。
 */
export function zhe(rate: number): string {
  const p = 100 - rate;
  return p % 10 === 0 ? String(p / 10) : String(p);
}
