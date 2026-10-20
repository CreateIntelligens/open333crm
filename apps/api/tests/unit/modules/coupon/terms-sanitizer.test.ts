/**
 * 券條款 HTML 消毒（純函式，不需 DB）。
 */
import assert from 'node:assert/strict';
import { it } from 'vitest';
import { sanitizeTerms } from '#src/modules/coupon/terms-sanitizer.js';

it('條款消毒移除 script 但保留合法標記', () => {
  const out = sanitizeTerms('<p>規則</p><script>alert(1)</script><a href="https://x.com">連結</a>') ?? '';
  assert.ok(!out.includes('alert'), 'script 未被移除');
  assert.ok(out.includes('<p>規則</p>'), '合法段落被移除');
  assert.ok(out.includes('noopener'), '外開連結未補 noopener');
});

it('條款消毒擋 javascript: 協議', () => {
  const out = sanitizeTerms('<a href="javascript:alert(1)">壞</a>') ?? '';
  assert.ok(!out.includes('javascript'), 'javascript: 協議未被擋');
});
