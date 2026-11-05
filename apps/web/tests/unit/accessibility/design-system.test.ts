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

describe('Web accessibility design system contract', () => {
  // 色票依 Figma 設計系統（change restore-figma-palette，2026-11-05 使用者決定）
  test('Light theme primary action：主色與 hover 是 Figma 的品牌藍', () => {
    assert.equal(token('primary'), '210 71% 54%'); // #378ADD
    assert.equal(token('primary-hover'), '211 66% 46%'); // #2876C4
    assert.equal(token('foreground'), '215 16% 25%'); // #37404C
  });

  test('Semantic status text：主要文字、成功、警告、AI 色達 AA 對比', () => {
    const lightBackground = token('background');
    assert.ok(contrast(token('foreground'), lightBackground) >= 4.5);
    assert.ok(contrast(token('warning-foreground'), token('warning')) >= 4.5);
    assert.ok(contrast(token('success-foreground'), token('success')) >= 4.5);
    assert.ok(contrast(token('ai-foreground'), token('ai')) >= 4.5);

    assert.ok(contrast(darkToken('warning'), darkToken('warning-subtle')) >= 4.5);
  });

  test('Documented contrast exceptions：次要文字與刪除紅維持 Figma 色值', () => {
    assert.equal(token('muted-foreground'), '215 15% 51%'); // #707E93，白底約 4.1:1
    assert.equal(token('destructive'), '359 84% 56%'); // #EE3134，白字約 4.1:1
    // 深色模式的成功、AI 標籤（文字在 subtle 底上）約 4.1:1、3.9:1
    assert.equal(darkToken('success-subtle'), '149 40% 20%');
    assert.equal(darkToken('ai-subtle'), '276 45% 24%');
  });

  test('Chinese-first typography and interaction contracts are explicit in CSS', () => {
    assert.match(css, /body\s*\{[\s\S]*font-size:\s*1rem/);
    assert.match(css, /\.text-xs[^{]*\{[\s\S]*font-size:\s*0\.84375rem/);
    assert.match(css, /min-height:\s*44px/);
    assert.match(css, /:focus-visible[^{]*\{[\s\S]*outline:/);
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
  });
});
