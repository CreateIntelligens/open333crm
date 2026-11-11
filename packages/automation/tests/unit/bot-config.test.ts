/**
 * 讀取機器人設定（change validate-bot-config-and-action-params，bot-handoff-config
 * 「讀取機器人設定時不合法的值改用預設值」；issue #405）。
 *
 * 修正前 getBotConfig() 以 `{ ...DEFAULT_BOT_CONFIG, ...raw }` 合併、不檢查型別：
 * handoffKeywords 含 '' 時每則訊息都轉接，handoffPromptEnabled 是 "false" 時被當成 true。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { DEFAULT_BOT_CONFIG, botConfigSchema, getBotConfig } from '#src/bot-config.js';

/** 設定畫面（BotConfigForm.tsx handleSave）會送出的完整內容 */
const FORM_BOT_CONFIG = {
  botMode: 'keyword',
  maxBotReplies: 8,
  handoffKeywords: ['真人', '客服'],
  handoffMessage: '馬上為您轉接',
  offlineGreeting: '目前非營業時間',
  handoffPromptEnabled: false,
  handoffPromptStyle: 'text',
  handoffButtonLabel: '找真人',
};

test('合法的完整設定原樣讀出', () => {
  assert.deepEqual(getBotConfig({ botConfig: FORM_BOT_CONFIG }), FORM_BOT_CONFIG);
});

test('沒有設定時使用預設值', () => {
  assert.deepEqual(getBotConfig(undefined), DEFAULT_BOT_CONFIG);
  assert.deepEqual(getBotConfig({ botConfig: null }), DEFAULT_BOT_CONFIG);
  assert.deepEqual(getBotConfig({ botConfig: 'x' }), DEFAULT_BOT_CONFIG);
});

test('轉接關鍵字有空字串：只使用不空白的字串', () => {
  const config = getBotConfig({ botConfig: { handoffKeywords: ['', '真人', '  ', 3] } });
  assert.deepEqual(config.handoffKeywords, ['真人']);
});

test('欄位型別錯誤：改用各欄位的預設值', () => {
  const config = getBotConfig({
    botConfig: {
      botMode: 'auto',
      maxBotReplies: null,
      handoffKeywords: '真人,客服',
      handoffPromptEnabled: 'false',
      handoffPromptStyle: 'popup',
      handoffButtonLabel: 42,
      offlineGreeting: { text: 'x' },
    },
  });
  assert.equal(config.botMode, DEFAULT_BOT_CONFIG.botMode);
  assert.equal(config.maxBotReplies, 5);
  assert.deepEqual(config.handoffKeywords, DEFAULT_BOT_CONFIG.handoffKeywords);
  assert.equal(config.handoffPromptEnabled, true);
  assert.equal(config.handoffPromptStyle, 'button');
  assert.equal(config.handoffButtonLabel, DEFAULT_BOT_CONFIG.handoffButtonLabel);
  assert.equal(config.offlineGreeting, undefined);
});

test('超出範圍的最大回覆次數改用預設值', () => {
  for (const value of [0, 9999, 2.5, '5']) {
    assert.equal(getBotConfig({ botConfig: { maxBotReplies: value } }).maxBotReplies, 5, String(value));
  }
});

test('轉接訊息空白：使用預設轉接訊息', () => {
  assert.equal(getBotConfig({ botConfig: { handoffMessage: '' } }).handoffMessage, '稍等，正在為您轉接客服人員');
  assert.equal(getBotConfig({ botConfig: { handoffMessage: { a: 1 } } }).handoffMessage, '稍等，正在為您轉接客服人員');
});

test('botConfigSchema：設定畫面送出的完整內容通過（handoffMessage 空字串、handoffKeywords 空陣列、沒有 offlineGreeting）', () => {
  const { offlineGreeting: _omit, ...withoutGreeting } = FORM_BOT_CONFIG;
  assert.equal(botConfigSchema.safeParse(FORM_BOT_CONFIG).success, true);
  assert.equal(botConfigSchema.safeParse({ ...withoutGreeting, handoffMessage: '', handoffKeywords: [] }).success, true);
  assert.equal(botConfigSchema.safeParse({ ...FORM_BOT_CONFIG, extra: { kept: true } }).success, true, '其他鍵照舊接受');
});

test('botConfigSchema：壞值被拒並指出欄位', () => {
  const cases: Array<[Record<string, unknown>, Array<string | number>]> = [
    [{ handoffKeywords: ['真人', ' '] }, ['handoffKeywords', 1]],
    [{ handoffKeywords: '真人,客服' }, ['handoffKeywords']],
    [{ handoffPromptEnabled: 'false' }, ['handoffPromptEnabled']],
    [{ botMode: 'auto' }, ['botMode']],
    [{ handoffPromptStyle: 'popup' }, ['handoffPromptStyle']],
    [{ maxBotReplies: 9999 }, ['maxBotReplies']],
    [{ handoffMessage: 1 }, ['handoffMessage']],
    [{ handoffButtonLabel: '超'.repeat(21) }, ['handoffButtonLabel']],
  ];
  for (const [value, path] of cases) {
    const result = botConfigSchema.safeParse(value);
    assert.equal(result.success, false, JSON.stringify(value));
    assert.deepEqual(result.error?.issues[0]?.path, path);
  }
});
