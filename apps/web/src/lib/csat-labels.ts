/** 滿意度分數（1～5）的中文說明：收件匣問卷卡片、工單時間軸與工單詳情共用 */
const CSAT_SCORE_LABELS = ['', '非常不滿意', '不滿意', '一般', '滿意', '非常滿意'];

export function csatScoreLabel(score: number): string {
  return CSAT_SCORE_LABELS[score] ?? '';
}
