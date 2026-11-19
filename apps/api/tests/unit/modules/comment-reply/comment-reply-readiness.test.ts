/**
 * readiness 的「缺少的權限」依平台開放的能力判斷（issue #529；spec comment-reply-meta-subscription「前置條件查詢」）。
 *
 * 走真實的 FB／IG 外掛（只把 fetch 換成假的 Graph API），確認 service 與外掛之間的欄位接得起來：
 * 外掛回報權杖缺少的所有權限，並在 capabilities.optionalPermissions 標出哪些只屬於選用功能；
 * service 依平台能力開關決定哪些算缺少。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';
import { fbPlugin, threadsPlugin, type ChannelCommentExtension } from '@open333crm/channel-plugins';
import type { ReadinessBase } from '#src/modules/comment-reply/comment-reply-channel.service.js';
import { buildReadiness } from '#src/modules/comment-reply/comment-reply-meta.js';
import { DEFAULT_COMMENT_REPLY_CAPABILITIES, type CommentReplyCapabilityFlags } from '#src/modules/comment-reply/comment-reply-platform-settings.js';

const BASE_SCOPES = ['pages_show_list', 'pages_manage_metadata', 'pages_messaging'];
let scopes: string[] = BASE_SCOPES;

beforeEach(() => {
  scopes = BASE_SCOPES;
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/debug_token')) return new Response(JSON.stringify({ data: { scopes } }));
    if (url.hostname === 'graph.instagram.com') return new Response(JSON.stringify({ data: [{ subscribed_fields: ['messages', 'comments'] }] }));
    return new Response(JSON.stringify({ data: [{ id: 'APP1', subscribed_fields: ['messages', 'feed'] }] }));
  }));
});
afterEach(() => vi.unstubAllGlobals());

function channel(ext: ChannelCommentExtension | undefined, over: Partial<ReadinessBase['channels'][number]> = {}): ReadinessBase['channels'][number] {
  assert.ok(ext, '外掛要有 extensions.comments');
  return {
    id: 'ch-fb',
    channelType: 'FB',
    displayName: '品牌粉專',
    accountId: 'PAGE1',
    credentials: { connectMode: 'platform', pageId: 'PAGE1', pageAccessToken: 'page-token' },
    appMode: 'platform',
    appSecret: 'sec',
    appId: 'APP1',
    ext,
    receiving: true,
    settingsCommentReply: {},
    tokenStatus: 'valid',
    lastCommentEventAt: null,
    igPermissionMissing24h: false,
    ...over,
  };
}

function base(caps: Partial<CommentReplyCapabilityFlags>, channels: ReadinessBase['channels']): ReadinessBase {
  return {
    testPhase: { fb: true, ig: true },
    capabilities: { ...DEFAULT_COMMENT_REPLY_CAPABILITIES, fbPrivateReply: true, igPrivateReply: true, ...caps },
    emergencyStopped: false,
    quota: { monthlyUsed: 0, monthlyLimit: null, activeRules: 0, maxRules: null },
    channels,
  };
}

const fb = () => channel(fbPlugin.extensions?.comments);
const fbReadiness = async (caps: Partial<CommentReplyCapabilityFlags>) => (await buildReadiness(base(caps, [fb()]), undefined)).channels[0]!;

describe('前置條件查詢：缺少的權限依平台開放的能力判斷', () => {
  test('公開回覆與貼文挑選未開放時不回報缺少其權限', async () => {
    const c = await fbReadiness({});
    assert.deepEqual(c.missingPermissions, []);
    assert.deepEqual(c.missingOptionalPermissions, { publicReply: [], postPicker: [] });
    assert.equal(c.canPrivateReply, true);
    assert.equal(c.canPublicReply, false);
  });

  test('公開回覆開放時回報缺少公開回覆權限', async () => {
    const c = await fbReadiness({ fbPublicReply: true });
    assert.deepEqual(c.missingPermissions, [], '公開回覆的權限不算必要權限');
    assert.deepEqual([...c.missingOptionalPermissions.publicReply].sort(), ['pages_manage_engagement', 'pages_read_engagement']);
    assert.deepEqual(c.missingOptionalPermissions.postPicker, []);
  });

  test('只開放貼文挑選時回報缺少讀取貼文權限', async () => {
    const c = await fbReadiness({ fbPostPicker: true });
    assert.deepEqual(c.missingPermissions, []);
    assert.deepEqual(c.missingOptionalPermissions, { publicReply: [], postPicker: ['pages_read_engagement'] });
  });

  test('缺少私訊權限', async () => {
    scopes = ['pages_show_list', 'pages_manage_metadata'];
    const c = await fbReadiness({});
    assert.deepEqual(c.missingPermissions, ['pages_messaging']);
    assert.deepEqual(c.missingOptionalPermissions, { publicReply: [], postPicker: [] });
    assert.equal(c.canPrivateReply, false);
  });

  test('權杖有全部權限、能力全開時都不回報', async () => {
    scopes = [...BASE_SCOPES, 'pages_manage_engagement', 'pages_read_engagement'];
    const c = await fbReadiness({ fbPublicReply: true, fbPostPicker: true });
    assert.deepEqual(c.missingPermissions, []);
    assert.deepEqual(c.missingOptionalPermissions, { publicReply: [], postPicker: [] });
    assert.equal(c.canPublicReply, true);
  });

  test('權限查不到時 missingPermissions 是 null', async () => {
    const c = (await buildReadiness(base({ fbPublicReply: true }, [channel(fbPlugin.extensions?.comments, { appId: undefined, appSecret: undefined })]), undefined)).channels[0]!;
    assert.equal(c.missingPermissions, null);
    assert.deepEqual(c.missingOptionalPermissions, { publicReply: [], postPicker: [] });
  });

  test('IG 近 24 小時有權限不足的失敗：留言權限仍算必要權限', async () => {
    const ig = channel(threadsPlugin.extensions?.comments, { id: 'ch-ig', channelType: 'THREADS', appMode: 'own_app', igPermissionMissing24h: true });
    const c = (await buildReadiness(base({ igPublicReply: true, igPostPicker: true }, [ig]), undefined)).channels[0]!;
    assert.deepEqual(c.missingPermissions, ['instagram_business_manage_comments']);
    assert.deepEqual(c.missingOptionalPermissions, { publicReply: [], postPicker: [] });
  });
});
