// @vitest-environment jsdom
/**
 * 前置條件卡與空狀態 A～E、平台暫停中（tasks 11.5；planning/01-ux.md §5；design D22、D28）。
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FB_ID, IG_ID, apiError, makeReadiness, ok, readinessChannel } from './fixtures';

const { api, auth } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
  auth: { granted: new Set<string>() },
}));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/providers/AuthProvider.js', () => ({ usePermission: (code: string) => auth.granted.has(code) }));

import {
  CommentReplyNoChannelState,
  CommentReplyReadinessCard,
  CommentReplyUnavailable,
} from '#src/components/comment-replies/CommentReplyReadinessCard.js';

function absent(el: Element | null, message = '元素不應存在') {
  assert.ok(el === null, `${message}：${el?.outerHTML.slice(0, 200)}`);
}

const onChanged = vi.fn(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
  auth.granted = new Set(['comment_reply.view', 'channel.view', 'channel.update', 'channel.create', 'channel.view_all']);
});

describe('空狀態 A：沒有可用的渠道', () => {
  test('總店帳號：還沒有連結渠道，提供前往渠道管理', () => {
    render(<CommentReplyNoChannelState />);
    screen.getByText('還沒有可以使用的粉專或 IG 帳號');
    const link = screen.getByRole('link', { name: '前往渠道管理' });
    assert.equal(link.getAttribute('href'), '/dashboard/settings/channels');
  });

  test('沒有新增渠道權限時請洽管理員', () => {
    auth.granted.delete('channel.create');
    render(<CommentReplyNoChannelState />);
    absent(screen.queryByRole('link', { name: '前往渠道管理' }));
    screen.getByText('請洽管理員連結渠道');
  });

  test('渠道都不在可見範圍：不說「沒有渠道」，請洽管理員開放權限', () => {
    auth.granted.delete('channel.view_all');
    render(<CommentReplyNoChannelState />);
    screen.getByText('你目前沒有可使用的粉專或 IG 帳號。若需要使用，請洽管理員開放渠道權限。');
    absent(screen.queryByText('還沒有可以使用的粉專或 IG 帳號'));
  });
});

describe('狀態 B：尚未開啟留言接收', () => {
  const readiness = () =>
    makeReadiness({
      channels: [
        readinessChannel({ receiving: false, subscribed: false }),
        readinessChannel({ channelId: IG_ID, channelType: 'THREADS', displayName: '@brand_official', receiving: false, subscribed: false, appMode: 'own_app', missingPermissions: null }),
      ],
    });

  test('列出未開啟的帳號，按鈕呼叫補訂閱', async () => {
    api.post.mockImplementation(() => ok({ receiving: true }));
    render(<CommentReplyReadinessCard readiness={readiness()} onChanged={onChanged} />);
    screen.getByText('2 個帳號尚未開啟留言接收，留言不會觸發規則');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '開啟「品牌粉專」的留言接收' }));
    });
    assert.equal(api.post.mock.calls[0][0], `/comment-replies/channels/${FB_ID}/subscribe-comments`);
    await screen.findByText('已開啟品牌粉專的留言接收');
    assert.equal(onChanged.mock.calls.length, 1);
  });

  test('需要重新授權時改導重新連結', async () => {
    api.post.mockImplementation((url: string) =>
      url === '/meta-connect/start' ? ok({ url: 'https://facebook.example/oauth' }) : Promise.reject(apiError(409, 'REAUTH_REQUIRED', '需要重新授權')),
    );
    render(<CommentReplyReadinessCard readiness={readiness()} onChanged={onChanged} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '開啟「品牌粉專」的留言接收' }));
    });
    await screen.findByText(/開啟失敗：需要重新授權。請改用「重新連結 Facebook」。/);
    screen.getByRole('button', { name: '重新連結 Facebook' });
  });

  test('沒有渠道修改權限時請洽管理員', () => {
    auth.granted.delete('channel.update');
    render(<CommentReplyReadinessCard readiness={readiness()} onChanged={onChanged} />);
    absent(screen.queryByRole('button', { name: /的留言接收$/ }));
    screen.getByText('請洽管理員到渠道管理開啟留言接收');
  });
});

describe('狀態 C：權限不足', () => {
  test('FB 缺授權時提示重新連結 Facebook', () => {
    const r = makeReadiness({ channels: [readinessChannel({ missingPermissions: ['pages_manage_engagement', 'pages_read_engagement'] })] });
    render(<CommentReplyReadinessCard readiness={r} onChanged={onChanged} />);
    screen.getByText('品牌粉專缺少必要的授權');
    screen.getByRole('button', { name: '重新連結 Facebook' });
  });

  test('IG 缺權限時提示重新產生權杖', () => {
    const r = makeReadiness({
      channels: [readinessChannel({ channelId: IG_ID, channelType: 'THREADS', displayName: '@brand_official', appMode: 'own_app', missingPermissions: ['instagram_business_manage_comments'] })],
    });
    render(<CommentReplyReadinessCard readiness={r} onChanged={onChanged} />);
    screen.getByText('Instagram 權杖可能缺少留言權限，請重新產生權杖後貼回渠道設定');
    absent(screen.queryByRole('button', { name: '重新連結 Facebook' }));
  });
});

describe('狀態 D：測試階段', () => {
  test('平台模式渠道顯示測試階段卡', () => {
    const r = makeReadiness({ testPhase: { fb: true, ig: false }, channels: [readinessChannel()] });
    render(<CommentReplyReadinessCard readiness={r} onChanged={onChanged} />);
    screen.getByText('目前為測試階段');
  });

  test('自備 App 的渠道不顯示測試階段卡', () => {
    const r = makeReadiness({ testPhase: { fb: true, ig: true }, channels: [readinessChannel({ appMode: 'own_app' })] });
    render(<CommentReplyReadinessCard readiness={r} onChanged={onChanged} />);
    absent(screen.queryByText('目前為測試階段'));
  });

  test('關閉測試階段後不顯示', () => {
    const r = makeReadiness({ testPhase: { fb: false, ig: false }, channels: [readinessChannel()] });
    const { container } = render(<CommentReplyReadinessCard readiness={r} onChanged={onChanged} />);
    absent(screen.queryByText('目前為測試階段'));
    assert.equal(container.textContent, '');
  });
});

describe('狀態 E 與平台暫停', () => {
  test('方案未含或沒有檢視權限時顯示無法使用', () => {
    render(<CommentReplyUnavailable />);
    screen.getByText(/目前的方案未包含留言自動私訊/);
  });

  test('平台暫停中', () => {
    render(<CommentReplyReadinessCard readiness={makeReadiness({ emergencyStopped: true })} onChanged={onChanged} />);
    screen.getByText('平台暫停中');
    screen.getByText(/新留言不會私訊，規則暫時不能修改/);
  });

  test('平台尚未開放 Instagram 留言私訊', () => {
    const r = makeReadiness();
    r.capabilities.igPrivateReply = false;
    render(<CommentReplyReadinessCard readiness={r} onChanged={onChanged} />);
    screen.getByText(/平台尚未開放 Instagram 留言自動私訊/);
  });
});
