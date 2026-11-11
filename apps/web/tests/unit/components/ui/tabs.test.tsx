// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, test } from 'vitest';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#src/components/ui/tabs.js';

describe('Tabs accessibility semantics', () => {
  test('exposes tablist, selected tab, and linked tabpanel', () => {
    function Example() {
      return (
        <Tabs value="open" onValueChange={() => undefined}>
          <TabsList aria-label="案件狀態">
            <TabsTrigger value="open">進行中</TabsTrigger>
            <TabsTrigger value="closed">已關閉</TabsTrigger>
          </TabsList>
          <TabsContent value="open">目前案件</TabsContent>
        </Tabs>
      );
    }

    render(<Example />);
    const list = screen.getByRole('tablist', { name: '案件狀態' });
    const selected = screen.getByRole('tab', { name: '進行中' });
    const panel = screen.getByRole('tabpanel');

    assert.equal(list.getAttribute('aria-orientation'), 'horizontal');
    assert.equal(selected.getAttribute('aria-selected'), 'true');
    assert.equal(selected.getAttribute('aria-controls'), panel.id);
    assert.equal(panel.getAttribute('aria-labelledby'), selected.id);

    const closed = screen.getByRole('tab', { name: '已關閉' });
    assert.equal(closed.getAttribute('aria-selected'), 'false');
    fireEvent.click(closed);
  });
});
