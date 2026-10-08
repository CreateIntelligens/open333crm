/** 成本計算公式（主規格 model-pricing「成本計算公式」） */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { Prisma } from '@prisma/client';
import type { ModelPricing } from '@prisma/client';
import { calcCostUsd } from '#src/modules/ai/pricing.service.js';

const d = (v: string) => new Prisma.Decimal(v);

function pricing(fields: Partial<ModelPricing>): ModelPricing {
  return {
    id: 'pricing-1',
    model: 'gemini-2.5-flash',
    inputPer1M: d('0.30'),
    outputPer1M: d('2.50'),
    cachedPer1M: d('0.03'),
    tierThreshold: null,
    tierInputPer1M: null,
    tierOutputPer1M: null,
    effectiveFrom: new Date(),
    createdAt: new Date(),
    ...fields,
  };
}

test('含快取與 thinking 的成本：costUsd 是 0.00238', () => {
  const cost = calcCostUsd(
    { promptTokens: 3000, cachedTokens: 1000, candidatesTokens: 200, thoughtsTokens: 500 },
    pricing({}),
  );
  assert.equal(cost?.toString(), '0.00238');
});

test('超過分級門檻整筆用高檔價：input 與 output 都改用 tier 價', () => {
  const pro = pricing({
    model: 'gemini-2.5-pro',
    inputPer1M: d('1.25'),
    outputPer1M: d('10.00'),
    cachedPer1M: d('0.31'),
    tierThreshold: 200_000,
    tierInputPer1M: d('2.50'),
    tierOutputPer1M: d('15.00'),
  });
  const usage = { promptTokens: 250_000, cachedTokens: 0, candidatesTokens: 1000, thoughtsTokens: 0 };

  // 250000 × 2.50 / 1e6 + 1000 × 15.00 / 1e6
  assert.equal(calcCostUsd(usage, pro)?.toString(), '0.64');
  // 沒超過門檻時用一般價：199999 × 1.25 / 1e6 + 1000 × 10.00 / 1e6
  assert.equal(calcCostUsd({ ...usage, promptTokens: 199_999 }, pro)?.toString(), '0.25999875');
});
