import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');

function luminanceFromHsl(hsl: string): number {
  const match = hsl.match(/(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/);
  assert.ok(match, `Invalid HSL token: ${hsl}`);
  const [h, s, l] = [Number(match[1]) / 360, Number(match[2]) / 100, Number(match[3]) / 100];
  const hue = (n: number) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => l - a * Math.max(-1, Math.min(hue(n) - 3, Math.min(9 - hue(n), 1)));
  const rgb = [channel(0), channel(8), channel(4)].map((value) => {
    const normalized = value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    return normalized;
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function token(name: string, source = css): string {
  const match = source.match(new RegExp(`--${name}:\\s*([^;]+);`));
  assert.ok(match, `Missing CSS token --${name}`);
  return match[1].trim();
}

function darkToken(name: string): string {
  const darkBlock = css.slice(css.indexOf('.dark {'));
  return token(name, darkBlock);
}

function contrast(foreground: string, background: string): number {
  const foregroundLum = luminanceFromHsl(foreground);
  const backgroundLum = luminanceFromHsl(background);
  return (Math.max(foregroundLum, backgroundLum) + 0.05) / (Math.min(foregroundLum, backgroundLum) + 0.05);
}

/*
 * 色票規格：設計師決定（feat/claude-design-skin 分支，Claude Design / Figma 改版）。
 * main 的版本（change restore-figma-palette）檢查 #378ADD、#707E93、#EE3134 等原始 Figma 色；
 * 本分支的色票由設計師調整為 WCAG AA 版本（見 globals.css 各 token 註解），合併 main 時以本分支為準，
 * 所以這裡改成檢查本分支的色票。字級與元件高度依 Figma Design System，不採用 main 的「中文最小字級 13.5px」
 * 與「全域 44px 最小高度」；main 的鍵盤焦點外框、減少動態效果、強制色彩模式保留。
 */
describe('Web accessibility design system contract', () => {
  test('Light theme primary action：主色、hover、主要文字是設計師決定的色票', () => {
    assert.equal(token('primary'), '210 66% 46%'); // #2876C4
    assert.equal(token('primary-hover'), '210 68% 37%');
    assert.equal(token('foreground'), '215 16% 25%'); // #37404C
    assert.equal(token('muted-foreground'), '217 14% 43%'); // #5F6B7E
    assert.equal(token('destructive'), '3 76% 45%'); // #C8251B
  });

  test('Semantic status text：文字、主色、刪除紅、成功、警告、AI 色在亮色模式達 AA 對比', () => {
    const white = '0 0% 100%';
    const lightBackground = token('background');
    assert.ok(contrast(token('foreground'), lightBackground) >= 4.5);
    assert.ok(contrast(token('muted-foreground'), lightBackground) >= 4.5);
    assert.ok(contrast(token('primary'), white) >= 4.5);
    assert.ok(contrast(token('destructive-foreground'), token('destructive')) >= 4.5);
    assert.ok(contrast(token('warning-foreground'), token('warning')) >= 4.5);
    assert.ok(contrast(token('success-foreground'), token('success')) >= 4.5);
    assert.ok(contrast(token('ai-foreground'), token('ai')) >= 4.5);

    // 深色模式不在設計範圍，警告底色沿用 main 的修正（26 50% 20%）以達 AA
    assert.ok(contrast(darkToken('warning'), darkToken('warning-subtle')) >= 4.5);
  });

  test('Documented contrast exceptions：深色模式的成功、AI 標籤底色', () => {
    // 深色模式的成功、AI 標籤（文字在 subtle 底上）約 4.1:1、3.9:1（與 main 相同的例外）
    assert.equal(darkToken('success-subtle'), '149 40% 20%');
    assert.equal(darkToken('ai-subtle'), '276 45% 24%');
  });

  test('Interaction contracts：保留 main 的焦點外框、減少動態效果、強制色彩模式', () => {
    assert.match(css, /:focus-visible[^{]*\{[\s\S]*outline:/);
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
    assert.match(css, /forced-colors:\s*active/);
  });

  test('Typography and sizing：不採用 main 的強制最小字級與全域 44px（設計師決定，依 Figma）', () => {
    assert.doesNotMatch(css, /font-size:\s*0\.84375rem/);
    assert.doesNotMatch(css, /min-height:\s*44px/);
  });
});
