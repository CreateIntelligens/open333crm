// @vitest-environment jsdom
/**
 * 留言自動私訊規則編輯頁（change add-comment-keyword-private-reply tasks 11.1；
 * planning/01-ux.md §3.3；spec comment-reply-rules、comment-reply-platform-controls「前端隱藏未開放的能力」）。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { beforeEach, describe, test, vi } from 'vitest';
import { act, fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { FB_ID, IG_ID, apiError, makeReadiness, makeRule, ok, readinessChannel } from './fixtures';

const { api, auth, router } = vi.hoisted(() => {
  const granted = new Set(['comment_reply.view', 'comment_reply.manage']);
  const reloadPermissions = async () => {};
  const hasPermission = (code: string) => granted.has(code);
  return {
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
    auth: { granted, reloadPermissions, hasPermission },
    router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
  };
});
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/providers/AuthProvider.js', () => ({
  usePermission: (code: string) => auth.granted.has(code),
  // 與真的 provider 一樣，每次回傳同一個函式
  useAuth: () => ({ hasPermission: auth.hasPermission, reloadPermissions: auth.reloadPermissions }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import { CommentReplyRuleEditor } from '#src/components/comment-replies/CommentReplyRuleEditor.js';

const DAY = 24 * 60 * 60 * 1000;

function render(ui: React.ReactElement) {
  return rtlRender(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);
}

/** 斷言元素不存在。不把 DOM 節點交給 assert 序列化。 */
function absent(el: Element | null, message = '元素不應存在') {
  assert.ok(el === null, `${message}：${el?.outerHTML.slice(0, 200)}`);
}

const posts = [
  { postId: '999_1', excerpt: '雙 11 留言 +1 抽第二杯半價', publishedAt: new Date(Date.now() - 1 * DAY).toISOString(), permalink: 'https://facebook.com/999/posts/1' },
  { postId: '999_2', excerpt: '公休公告', publishedAt: new Date(Date.now() - 10 * DAY).toISOString(), permalink: 'https://facebook.com/999/posts/2' },
];

beforeEach(() => {
  vi.clearAllMocks();
  auth.granted.clear();
  auth.granted.add('comment_reply.view');
  auth.granted.add('comment_reply.manage');
  api.get.mockImplementation((url: string) => {
    if (url.startsWith('/comment-replies/material-options')) {
      return ok([{ id: 'mat-1', name: '第二杯半價說明', contentType: 'fb_text', preview: '感謝參加' }]);
    }
    if (url.startsWith(`/comment-replies/channels/${FB_ID}/posts`)) return ok({ posts, nextCursor: null });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  api.post.mockImplementation((url: string, body: Record<string, unknown>) => {
    if (url === '/comment-replies/rules') return ok(makeRule({ id: 'rule-new', name: String(body.name), isActive: Boolean(body.isActive) }));
    return Promise.reject(new Error(`unexpected POST ${url}`));
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

async function chooseChannel(id: string) {
  const select = screen.getByLabelText('粉專或 IG 帳號') as HTMLSelectElement;
  await act(async () => {
    fireEvent.change(select, { target: { value: id } });
  });
}

function addKeyword(word: string) {
  const input = screen.getByLabelText('關鍵字') as HTMLInputElement;
  fireEvent.change(input, { target: { value: word } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

async function fillValidFbRule() {
  await chooseChannel(FB_ID);
  fireEvent.change(screen.getByLabelText('規則名稱'), { target: { value: '+1 領券' } });
  addKeyword('+1');
  fireEvent.click(screen.getByRole('button', { name: '文字' }));
  fireEvent.change(screen.getByLabelText('私訊文字'), { target: { value: '感謝留言' } });
}

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
  });
}

describe('欄位驗證', () => {
  test('必填錯誤文案顯示在欄位下，焦點移到第一個錯誤欄位，且不送出', async () => {
    render(<CommentReplyRuleEditor readiness={makeReadiness()} />);
    await save();

    // 下拉選單的提示選項也是這段文字，所以只找欄位下方的錯誤
    screen.getByText('請選擇粉專或 IG 帳號', { selector: 'p' });
    screen.getByText('請輸入規則名稱');
    screen.getByText('至少要 1 個關鍵字');
    screen.getByText('請選擇素材或輸入私訊文字');
    screen.getByText('有 4 個欄位需要修正');
    assert.equal(document.activeElement, screen.getByLabelText('粉專或 IG 帳號'));
    assert.equal(api.post.mock.calls.length, 0);
  });

  test('重複關鍵字（含全形半形）不加入並提示', async () => {
    render(<CommentReplyRuleEditor readiness={makeReadiness()} />);
    addKeyword('+1');
    addKeyword('＋１');

    screen.getByText('已經加入過了');
    assert.equal(screen.getAllByRole('button', { name: /^移除關鍵字/ }).length, 1);
  });

  test('短關鍵字只提示，仍可儲存', async () => {
    render(<CommentReplyRuleEditor readiness={makeReadiness()} />);
    await fillValidFbRule();
    addKeyword('1');
    screen.getByText(/這個關鍵字很短/);

    await save();
    assert.equal(api.post.mock.calls.length, 1);
    const [, body] = api.post.mock.calls[0];
    assert.deepEqual(body.keywords, ['+1', '1']);
  });

  test('比對方式只在 2 個以上關鍵字時顯示', async () => {
    render(<CommentReplyRuleEditor readiness={makeReadiness()} />);
    addKeyword('+1');
    absent(screen.queryByLabelText('任一關鍵字出現就觸發'));
    addKeyword('加一');
    assert.ok((screen.getByLabelText('任一關鍵字出現就觸發') as HTMLInputElement).checked);
    screen.getByLabelText('所有關鍵字都要出現才觸發');
  });

  test('IG 渠道停用素材選項，只能用文字', async () => {
    render(<CommentReplyRuleEditor readiness={makeReadiness()} />);
    await chooseChannel(IG_ID);
    assert.ok((screen.getByRole('button', { name: '素材' }) as HTMLButtonElement).disabled);
    screen.getByText('Instagram 目前沒有素材，只能用文字');
    screen.getByLabelText('私訊文字');
  });

  test('指定貼文卻沒有選貼文', async () => {
    render(<CommentReplyRuleEditor readiness={makeReadiness()} />);
    await fillValidFbRule();
    fireEvent.click(screen.getByLabelText('指定貼文'));
    await save();
    screen.getByText('請至少選擇 1 篇貼文');
    assert.equal(api.post.mock.calls.length, 0);
  });

  test('選了發布超過 7 天的貼文時提示，不擋儲存', async () => {
    render(<CommentReplyRuleEditor readiness={makeReadiness()} />);
    await fillValidFbRule();
    fireEvent.click(screen.getByLabelText('指定貼文'));
    const oldPost = await screen.findByRole('checkbox', { name: /公休公告/ });
    fireEvent.click(oldPost);
    screen.getByText(/這篇貼文已發布超過 7 天/);

    await save();
    const [, body] = api.post.mock.calls[0];
    assert.equal(body.postScope, 'selected');
    assert.deepEqual(body.posts.map((p: { postId: string }) => p.postId), ['999_2']);
  });

  test('開啟公開回覆卻沒有文字', async () => {
    render(<CommentReplyRuleEditor readiness={makeReadiness()} />);
    await fillValidFbRule();
    fireEvent.click(screen.getByRole('switch', { name: '同時公開回覆這則留言' }));
    await save();
    screen.getByText('請輸入公開回覆的文字，或關閉公開回覆');
    assert.equal(api.post.mock.calls.length, 0);
  });

  test('缺公開回覆權限時停用開關並說明重新連結', async () => {
    const readiness = makeReadiness({ channels: [readinessChannel({ canPublicReply: false })] });
    render(<CommentReplyRuleEditor readiness={readiness} />);
    // 只有一個渠道時直接選它
    const toggle = screen.getByRole('switch', { name: '同時公開回覆這則留言' }) as HTMLButtonElement;
    assert.ok(toggle.disabled);
    screen.getByText(/需要重新連結 Facebook 並同意「管理貼文互動」權限/);
  });

  test('後端 details.field 的錯誤顯示在對應欄位下', async () => {
    api.post.mockRejectedValueOnce(apiError(400, 'VALIDATION_ERROR', '關鍵字正規化後重複', { field: 'keywords' }));
    render(<CommentReplyRuleEditor readiness={makeReadiness()} />);
    await fillValidFbRule();
    await save();
    const field = document.getElementById('cr-field-keywords');
    assert.ok(field, '找不到關鍵字欄位');
    within(field as HTMLElement).getByText('關鍵字正規化後重複');
  });

  test('素材含顧客專屬券連結時說明改用回覆關鍵字領券', async () => {
    api.post.mockRejectedValueOnce(apiError(400, 'COUPON_URL_IN_RULE_MESSAGE', '素材含顧客專屬券連結', { field: 'content' }));
    render(<CommentReplyRuleEditor readiness={makeReadiness()} />);
    await fillValidFbRule();
    await save();
    const field = document.getElementById('cr-field-content') as HTMLElement;
    within(field).getByText(/請改用「回覆關鍵字領券」的玩法/);
  });
});

describe('編輯與離開', () => {
  test('編輯時渠道唯讀', async () => {
    render(<CommentReplyRuleEditor readiness={makeReadiness()} rule={makeRule()} />);
    absent(screen.queryByLabelText('粉專或 IG 帳號'));
    screen.getByText('渠道建立後不能更改；要換渠道請刪除後重新建立');
    within(document.getElementById('cr-field-channel') as HTMLElement).getByText('Facebook · 品牌粉專');
  });

  test('編輯時送 PATCH，不帶 channelId', async () => {
    api.patch.mockImplementation(() => ok(makeRule()));
    render(<CommentReplyRuleEditor readiness={makeReadiness()} rule={makeRule()} />);
    fireEvent.change(screen.getByLabelText('規則名稱'), { target: { value: '改名' } });
    await save();
    assert.equal(api.patch.mock.calls.length, 1);
    const [url, body] = api.patch.mock.calls[0];
    assert.equal(url, '/comment-replies/rules/rule-1');
    assert.equal(body.name, '改名');
    assert.ok(!('channelId' in body));
  });

  test('有未儲存的變更時按取消要確認，取消確認就留在頁面', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<CommentReplyRuleEditor readiness={makeReadiness()} />);
    fireEvent.change(screen.getByLabelText('規則名稱'), { target: { value: '未存' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    assert.equal(vi.mocked(window.confirm).mock.calls[0][0], '有尚未儲存的變更，確定離開？');
    assert.equal(router.push.mock.calls.length, 0);
  });

  test('沒有變更時按取消直接回列表', async () => {
    render(<CommentReplyRuleEditor readiness={makeReadiness()} />);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    assert.equal(vi.mocked(window.confirm).mock.calls.length, 0);
    assert.equal(router.push.mock.calls[0][0], '/dashboard/comment-replies');
  });

  test('儲存成功訊息不含勾勾，送出的內容符合 RuleInput', async () => {
    render(<CommentReplyRuleEditor readiness={makeReadiness()} />);
    await fillValidFbRule();
    await save();
    await screen.findByText('已儲存，規則已啟用');
    assert.ok(!/[✓✔✅]/.test(document.body.textContent ?? ''));
    const [url, body] = api.post.mock.calls[0];
    assert.equal(url, '/comment-replies/rules');
    assert.deepEqual(body, {
      channelId: FB_ID,
      name: '+1 領券',
      keywords: ['+1'],
      matchMode: 'any',
      postScope: 'all',
      posts: [],
      content: { type: 'text', text: '感謝留言' },
      dedupePerCommenter: true,
      publicReply: { enabled: false, texts: [] },
      isActive: true,
    });
  });

  test('只有檢視權限時表單唯讀、沒有儲存', async () => {
    auth.granted.delete('comment_reply.manage');
    render(<CommentReplyRuleEditor readiness={makeReadiness()} rule={makeRule({ canEdit: false })} />);
    screen.getByText('你只有檢視權限，無法修改規則');
    absent(screen.queryByRole('button', { name: '儲存' }));
    assert.ok((screen.getByLabelText('規則名稱') as HTMLInputElement).disabled);
  });
});

describe('平台能力與素材', () => {
  test('前端隱藏未開放的能力：沒有貼文挑選時只能手動填貼文 ID，沒有公開回覆時不顯示區塊', async () => {
    const readiness = makeReadiness();
    readiness.capabilities.fbPostPicker = false;
    readiness.capabilities.fbPublicReply = false;
    render(<CommentReplyRuleEditor readiness={readiness} />);
    await chooseChannel(FB_ID);
    fireEvent.click(screen.getByLabelText('指定貼文'));

    absent(screen.queryByText('從最近貼文挑選'));
    screen.getByLabelText('貼文 ID 或網址');
    absent(screen.queryByRole('switch', { name: '同時公開回覆這則留言' }));
    assert.ok(!api.get.mock.calls.some(([url]) => String(url).includes('/posts')));
  });

  test('平台未開放 IG 私訊時，IG 帳號不能選', async () => {
    const readiness = makeReadiness();
    readiness.capabilities.igPrivateReply = false;
    render(<CommentReplyRuleEditor readiness={readiness} />);
    const option = screen.getByRole('option', { name: /@brand_official/ }) as HTMLOptionElement;
    assert.ok(option.disabled);
  });

  test('沒有 marketing.view 時素材選項仍可用（走本模組的 material-options）', async () => {
    assert.ok(!auth.granted.has('marketing.view'));
    render(<CommentReplyRuleEditor readiness={makeReadiness()} />);
    await chooseChannel(FB_ID);
    fireEvent.click(screen.getByRole('button', { name: '素材' }));
    await screen.findByRole('option', { name: '第二杯半價說明' });
    assert.ok(api.get.mock.calls.some(([url]) => url === `/comment-replies/material-options?channelId=${FB_ID}`));
    assert.ok(!api.get.mock.calls.some(([url]) => String(url).startsWith('/materials') || String(url).startsWith('/marketing')));
  });

  test('平台暫停中時停用編輯', async () => {
    render(<CommentReplyRuleEditor readiness={makeReadiness({ emergencyStopped: true })} rule={makeRule()} />);
    screen.getByText(/平台暫停中/);
    absent(screen.queryByRole('button', { name: '儲存' }));
  });

  test('測試階段卡只對平台模式渠道顯示', async () => {
    const readiness = makeReadiness({ testPhase: { fb: true, ig: true } });
    render(<CommentReplyRuleEditor readiness={readiness} />);
    await chooseChannel(FB_ID);
    screen.getByText('目前為測試階段');
    await chooseChannel(IG_ID);
    await waitFor(() => absent(screen.queryByText('目前為測試階段')));
  });
});
