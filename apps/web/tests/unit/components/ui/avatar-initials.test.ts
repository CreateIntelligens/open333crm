/**
 * 頭像縮寫：名字含 emoji 時不能出現亂碼（原本用 n[0] 會把 emoji 切成半個代理字元，顯示成「�」）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { initialsOf } from '#src/components/ui/avatar.js';

test('中文姓名取第一個字', () => {
  assert.equal(initialsOf('林佩君'), '林');
});

test('英文姓名取前兩個字的字首', () => {
  assert.equal(initialsOf('Michael Huang'), 'MH');
  assert.equal(initialsOf('Christopher Alexander Montgomery-Williamson'), 'CA');
});

test('emoji 開頭或夾雜 emoji 時略過 emoji，不出現亂碼', () => {
  assert.equal(initialsOf('🌸 櫻花妹 🌸'), '櫻');
  assert.equal(initialsOf('小熊 🐻'), '小');
  assert.ok(!initialsOf('🐻🐻').includes('\uFFFD'));
});

test('沒有名字時顯示問號', () => {
  assert.equal(initialsOf(''), '?');
  assert.equal(initialsOf(undefined), '?');
  assert.equal(initialsOf('👍'), '?');
});
