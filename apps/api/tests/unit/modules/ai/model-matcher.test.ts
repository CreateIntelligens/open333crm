/**
 * 型號偵測（issue #420，AUDIT KB-02，change fix-kb-model-guard-420：
 * bot-handoff-config「型號守門只攔截知識庫型號格式的型號」）。
 *
 * 型號是大寫英文前綴加 `-` 與大寫英數（例如 TAC-11P、TAC-06L-MCW）。
 * 一般英文詞（Wi-Fi、e-mail、T-shirt）與小寫詞不是型號。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { detectModels, hasKnownPrefix } from '#src/modules/ai/model-matcher.js';

const raws = (text: string) => detectModels(text).map((m) => m.raw);

describe('detectModels：一般英文詞不當成型號', () => {
  test.each([
    ['我家 Wi-Fi 連不上怎麼辦'],
    ['請問可以寄 e-mail 給你們嗎'],
    ['我想買 T-shirt'],
    ['WI-FI 密碼忘了'],
    ['請寄 E-MAIL 給我'],
    ['T-SHIRT 有幾種尺寸'],
    ['要用 USB-C 還是 Type-C 充電'],
    ['我家的 HDMI-2 接不上'],
  ])('%s → 不命中', (text) => {
    assert.deepEqual(raws(text), []);
  });

  test('小寫的型號格式不命中', () => {
    assert.deepEqual(raws('tac-11p 怎麼清洗'), []);
    assert.deepEqual(raws('Tac-11p 怎麼清洗'), []);
  });
});

describe('detectModels：真實型號仍命中', () => {
  test.each([
    ['TAC-11P 怎麼清洗', 'TAC-11P', 'TAC-11P'],
    ['我的電鍋是TAC-06L-MCW', 'TAC-06L-MCW', 'TAC-06L'],
    ['TAC-11A-MB 內鍋可以單買嗎', 'TAC-11A-MB', 'TAC-11A'],
    ['冷氣 TAW-A080WM 遙控器', 'TAW-A080WM', 'TAW-A080WM'],
    ['除濕機TDH-168MC-NW', 'TDH-168MC-NW', 'TDH-168MC'],
    ['AC-9 的濾網', 'AC-9', 'AC-9'],
  ])('%s → %s', (text, raw, key) => {
    const found = detectModels(text);
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.equal(found[0].raw, raw);
    assert.equal(found[0].key, key);
  });

  test('同一則訊息有型號也有一般英文詞：只回型號', () => {
    assert.deepEqual(raws('TAC-11P 可以連 Wi-Fi 嗎？還是要 E-MAIL 問'), ['TAC-11P']);
  });
});

describe('hasKnownPrefix', () => {
  const known = new Set(['TAC-11A', 'TAC-06L', 'TDH-168MC']);

  test('前綴在白名單：true', () => {
    assert.equal(hasKnownPrefix(detectModels('TAC-11P')[0], known), true);
  });

  test('前綴不在白名單（例如訂單編號 AB-12345）：false', () => {
    assert.equal(hasKnownPrefix(detectModels('AB-12345')[0], known), false);
  });
});
