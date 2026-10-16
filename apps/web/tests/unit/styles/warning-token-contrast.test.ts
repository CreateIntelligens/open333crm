/**
 * warning 色票的文字對比度要達 WCAG AA（一般文字 4.5:1）。
 * 原本淺色模式的 --warning 是 #FF6E00：白底上 2.8:1、淺橘底（--warning-subtle）上 2.5:1，
 * 「自動開啟」標籤、SLA 預警等 text-warning 文字幾乎看不清楚。
 *
 * 色票只存在 CSS 變數裡，元件測試的 jsdom 不會套用 globals.css，所以這裡直接讀色票計算。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('../../../src/app/globals.css', import.meta.url)), 'utf8');

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `globals.css 找不到 ${selector}`);
  return css.slice(start, css.indexOf('}', start));
}

function token(scope: string, name: string): [number, number, number] {
  const m = scope.match(new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
  assert.ok(m, `找不到 --${name}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(hslToRgb(a)), luminance(hslToRgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

for (const [mode, selector] of [['淺色', ':root'], ['深色', '.dark']] as const) {
  const scope = block(selector);
  const pairs: Array<[string, string, string]> = [
    ['text-warning 在頁面底色上', 'warning', 'background'],
    ['text-warning 在卡片上', 'warning', 'card'],
    ['text-warning 在 bg-warning-subtle 上', 'warning', 'warning-subtle'],
    ['bg-warning 上的 warning-foreground 文字', 'warning-foreground', 'warning'],
  ];
  for (const [label, fg, bg] of pairs) {
    test(`${mode}模式：${label}的對比度至少 4.5:1`, () => {
      const ratio = contrast(token(scope, fg), token(scope, bg));
      assert.ok(ratio >= 4.5, `${label}：${ratio.toFixed(2)}:1`);
    });
  }
}
