/**
 * 機器人設定的寫入檢查（channel-management）：
 * - 「Bot 最大回覆次數的範圍」（change fix-admin-settings-safeguards，G04：畫面限制 1～50，後端不驗證，實際存進 9999）
 * - 「機器人設定欄位的型別與範圍」（change validate-bot-config-and-action-params，issue #405）
 *
 * 建立渠道沒有舊值，在路由（createChannelSchema）檢查；更新渠道在 updateChannel() 檢查，
 * 送出的 botConfig 與已存的相同時不檢查（Downstream Webhook 設定視窗會把整包 settings 原樣送回）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { AppError } from '#src/shared/utils/response.js';

process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'unit-test-credential-encryption-key!!!!';

const { createChannelSchema, updateChannelSchema } = await import('#src/modules/channel/channel.routes.js');
const { encryptCredentials, updateChannel } = await import('#src/modules/channel/channel.service.js');

const TENANT = '11111111-1111-4111-8111-111111111111';
const CHANNEL = '33333333-3333-4333-8333-333333333333';

/** 設定畫面（BotConfigForm.tsx handleSave）實際送出的 botConfig：8 個欄位都有 */
const FORM_BOT_CONFIG = {
  botMode: 'keyword_then_llm',
  maxBotReplies: 5,
  handoffKeywords: [] as string[],
  handoffMessage: '',
  offlineGreeting: '目前非營業時間，明天回覆您',
  handoffPromptEnabled: true,
  handoffPromptStyle: 'button',
  handoffButtonLabel: '💬 轉接客服',
};

/** 設定畫面實際送出的整包 settings（...existingSettings、botConfig、liffConfig、firstContactGreeting） */
function formSettings(botConfig: Record<string, unknown>) {
  return {
    botConfig,
    liffConfig: { liffId: '', loginChannelId: '' },
    firstContactGreeting: '',
  };
}

/** 一個渠道的記憶體資料庫；settings 寫入時記下送出的內容 */
function channelDb(settings: Record<string, unknown>) {
  const row: Record<string, unknown> = {
    id: CHANNEL, tenantId: TENANT, channelType: 'LINE', displayName: 'LINE', isActive: true,
    credentialsEncrypted: encryptCredentials({ channelSecret: 's', channelAccessToken: 't' }), settings,
  };
  const writes: Array<Record<string, unknown>> = [];
  const db = {
    channel: {
      findFirst: async () => ({ ...row }),
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(row, data),
    },
    $executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const incoming = JSON.parse(values[0] as string) as Record<string, unknown>;
      writes.push(incoming);
      row.settings = incoming;
      return 1;
    },
  };
  return { db, row, writes };
}

async function rejectedIssues(promise: Promise<unknown>): Promise<Array<{ path: string; message: string }>> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof AppError, String(err));
    assert.equal(err.statusCode, 400);
    assert.equal(err.code, 'VALIDATION_ERROR');
    return (err.details as { issues: Array<{ path: string; message: string }> }).issues;
  }
  assert.fail('應回 400');
}

// ── Bot 最大回覆次數的範圍 ─────────────────────────────────────────

test('範圍內的值可以儲存', async () => {
  for (const maxBotReplies of [1, 10, 50]) {
    const { db, row } = channelDb({});
    await updateChannel(db as never, CHANNEL, TENANT, { settings: { botConfig: { botMode: 'keyword_then_llm', maxBotReplies } } });
    assert.equal((row.settings as { botConfig: { maxBotReplies: number } }).botConfig.maxBotReplies, maxBotReplies);
  }
  const { db } = channelDb({});
  await updateChannel(db as never, CHANNEL, TENANT, { settings: { botConfig: { botMode: 'off' } } });
});

test('超出範圍的值被拒', async () => {
  for (const v of [9999, 0, -1, 2.5, '5']) {
    const { db, writes } = channelDb({});
    const issues = await rejectedIssues(
      updateChannel(db as never, CHANNEL, TENANT, { settings: { botConfig: { botMode: 'keyword_then_llm', maxBotReplies: v } } }),
    );
    assert.equal(issues[0]!.path, 'settings.botConfig.maxBotReplies', `${v} 應被拒`);
    assert.equal(writes.length, 0, '渠道的設定不變');
  }
});

test('建立渠道時超出範圍的值被拒', () => {
  const created = createChannelSchema.safeParse({
    channelType: 'WEBCHAT',
    displayName: 'w',
    credentials: {},
    settings: { botConfig: { botMode: 'keyword_then_llm', maxBotReplies: 9999 } },
  });
  assert.equal(created.success, false);
  assert.deepEqual(created.error?.issues[0]?.path, ['settings', 'botConfig', 'maxBotReplies']);
});

test('未改動的舊值不阻擋其他設定', async () => {
  const stored = { botMode: 'keyword_then_llm', maxBotReplies: 9999 };
  const { db, row } = channelDb({ botConfig: stored });
  const downstreamWebhook = { enabled: true, url: 'https://example.com/hook', mode: 'forward' };
  // 鍵的順序不同仍視為相同
  await updateChannel(db as never, CHANNEL, TENANT, {
    settings: { botConfig: { maxBotReplies: 9999, botMode: 'keyword_then_llm' }, downstreamWebhook },
  });
  assert.deepEqual((row.settings as Record<string, unknown>).downstreamWebhook, downstreamWebhook);
  assert.deepEqual((row.settings as Record<string, unknown>).botConfig, stored);
});

// ── 機器人設定欄位的型別與範圍 ─────────────────────────────────────

test('設定畫面送出的完整設定可以儲存', async () => {
  const { db, row } = channelDb({ botConfig: { botMode: 'off' } });
  await updateChannel(db as never, CHANNEL, TENANT, { settings: formSettings(FORM_BOT_CONFIG) });
  assert.deepEqual((row.settings as Record<string, unknown>).botConfig, FORM_BOT_CONFIG);

  // 沒有填非營業時間招呼語時，前端送 undefined（JSON 不帶這個鍵）
  const { offlineGreeting: _omit, ...withoutGreeting } = FORM_BOT_CONFIG;
  const second = channelDb({});
  await updateChannel(second.db as never, CHANNEL, TENANT, {
    settings: formSettings({ ...withoutGreeting, handoffKeywords: ['真人', '人工', '客服', '轉接'], handoffMessage: '稍等' }),
  });
  assert.equal(second.writes.length, 1);

  // 路由也讓前端的完整內容通過
  assert.equal(updateChannelSchema.safeParse({ settings: formSettings(FORM_BOT_CONFIG) }).success, true);
  assert.equal(
    createChannelSchema.safeParse({ channelType: 'LINE', displayName: 'L', credentials: { channelSecret: 's', channelAccessToken: 't' }, settings: formSettings(FORM_BOT_CONFIG) }).success,
    true,
  );
});

test('轉接關鍵字有空白字串被拒', async () => {
  const { db, writes } = channelDb({});
  const issues = await rejectedIssues(
    updateChannel(db as never, CHANNEL, TENANT, { settings: formSettings({ ...FORM_BOT_CONFIG, handoffKeywords: ['真人', ' '] }) }),
  );
  assert.equal(issues[0]!.path, 'settings.botConfig.handoffKeywords.1');
  assert.equal(writes.length, 0);
});

test('型別錯誤的欄位被拒', async () => {
  const bad: Array<[Record<string, unknown>, string]> = [
    [{ handoffPromptEnabled: 'false' }, 'settings.botConfig.handoffPromptEnabled'],
    [{ handoffKeywords: '真人,客服' }, 'settings.botConfig.handoffKeywords'],
    [{ botMode: 'auto' }, 'settings.botConfig.botMode'],
  ];
  for (const [patch, path] of bad) {
    const { db, writes } = channelDb({});
    const issues = await rejectedIssues(
      updateChannel(db as never, CHANNEL, TENANT, { settings: formSettings({ ...FORM_BOT_CONFIG, ...patch }) }),
    );
    assert.equal(issues[0]!.path, path);
    assert.equal(writes.length, 0);

    const created = createChannelSchema.safeParse({
      channelType: 'WEBCHAT', displayName: 'w', credentials: {}, settings: formSettings({ ...FORM_BOT_CONFIG, ...patch }),
    });
    assert.equal(created.success, false, `建立渠道：${path}`);
  }

  const { db } = channelDb({});
  const issues = await rejectedIssues(updateChannel(db as never, CHANNEL, TENANT, { settings: { botConfig: 'x' } }));
  assert.equal(issues[0]!.path, 'settings.botConfig');
});

test('未改動的舊設定不阻擋其他設定', async () => {
  const stored = { ...FORM_BOT_CONFIG, handoffKeywords: [''] };
  const { db, row } = channelDb({ botConfig: stored });
  await updateChannel(db as never, CHANNEL, TENANT, { settings: { botConfig: stored, firstContactGreeting: '歡迎' } });
  assert.equal((row.settings as Record<string, unknown>).firstContactGreeting, '歡迎');
});
