// @vitest-environment jsdom
/**
 * 收件匣「來自留言」標籤與系統訊息連結（change add-comment-keyword-private-reply tasks 11.6；
 * spec comment-reply-contact-linking「收件匣標示來自留言的對話」；design Open Questions 6：標籤顯示 7 天）。
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const { auth } = vi.hoisted(() => ({ auth: { granted: new Set<string>() } }));
vi.mock('#src/providers/AuthProvider.js', () => ({ usePermission: (code: string) => auth.granted.has(code) }));

import { ConversationListItem } from '#src/components/inbox/ConversationListItem.js';
import { MessageBubble } from '#src/components/inbox/MessageBubble.js';

function absent(el: Element | null, message = '元素不應存在') {
  assert.ok(el === null, `${message}：${el?.outerHTML.slice(0, 200)}`);
}

const DAY = 24 * 60 * 60 * 1000;

function conversation(origin: unknown) {
  return {
    id: 'conv-1',
    contact: { id: 'ct-1', name: '王小明' },
    channelType: 'FB',
    channel: { id: 'ch-1', displayName: '品牌粉專', channelType: 'FB' },
    status: 'OPEN',
    updatedAt: new Date().toISOString(),
    lastMessage: { content: '我要領券', contentType: 'text', createdAt: new Date().toISOString() },
    origin,
  } as never;
}

beforeEach(() => {
  auth.granted = new Set();
});

describe('對話列表的「來自留言」標籤', () => {
  test('第一個來源是留言私訊且在 7 天內時顯示', () => {
    render(
      <ConversationListItem
        conversation={conversation({ type: 'comment_private_reply', logId: 'log-1', at: new Date(Date.now() - 2 * DAY).toISOString() })}
        isSelected={false}
        onClick={() => {}}
      />,
    );
    screen.getByText('來自留言');
  });

  test('超過 7 天不再顯示', () => {
    render(
      <ConversationListItem
        conversation={conversation({ type: 'comment_private_reply', logId: 'log-1', at: new Date(Date.now() - 8 * DAY).toISOString() })}
        isSelected={false}
        onClick={() => {}}
      />,
    );
    absent(screen.queryByText('來自留言'));
  });

  test('一般對話不顯示', () => {
    render(<ConversationListItem conversation={conversation(null)} isSelected={false} onClick={() => {}} />);
    absent(screen.queryByText('來自留言'));
  });
});

describe('對話開頭的系統訊息', () => {
  const originNote = {
    id: 'm-origin',
    direction: 'OUTBOUND',
    contentType: 'system',
    senderType: 'SYSTEM',
    content: { text: '此對話來自貼文留言：顧客在〈雙 11 留言 +1…〉留言「我要 +1」，系統依規則「雙 11 留 +1」自動私訊。' },
    createdAt: '2026-11-13T06:02:00.000Z',
    metadata: { source: 'comment_private_reply', kind: 'origin_note', logId: 'log-1' },
  };

  test('有 comment_reply.view 時顯示「查看留言紀錄」連結', () => {
    auth.granted.add('comment_reply.view');
    render(<MessageBubble message={originNote} />);
    screen.getByText(/此對話來自貼文留言/);
    const link = screen.getByRole('link', { name: '查看留言紀錄' });
    assert.equal(link.getAttribute('href'), '/dashboard/comment-replies?tab=logs&logId=log-1');
  });

  test('沒有 comment_reply.view 時只顯示文字', () => {
    render(<MessageBubble message={originNote} />);
    screen.getByText(/此對話來自貼文留言/);
    absent(screen.queryByRole('link', { name: '查看留言紀錄' }));
  });

  test('補入的私訊標示為自動私訊', () => {
    render(
      <MessageBubble
        message={{
          id: 'm-dm',
          direction: 'OUTBOUND',
          contentType: 'text',
          // planning/02-architecture.md §6.5：私訊快照的 senderType 也是 SYSTEM，以 metadata.source 區分
          senderType: 'SYSTEM',
          content: { text: '感謝參加雙 11 活動！回覆「領券」即可領取' },
          createdAt: '2026-11-13T06:02:01.000Z',
          metadata: { source: 'comment_private_reply', logId: 'log-1' },
        }}
      />,
    );
    // 以外送泡泡顯示（不是置中的系統提示），並標示發送者
    const text = screen.getByText(/感謝參加雙 11 活動/);
    assert.ok(!text.className.includes('italic'), '私訊快照不應以系統提示樣式顯示');
    within(document.body).getByText('留言自動私訊');
  });
});
