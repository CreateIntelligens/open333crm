import assert from 'node:assert/strict';
import test from 'node:test';

interface NavNode {
  id: string;
  label: string;
  href?: string;
  perm?: string;
  children?: NavNode[];
}

// Mirroring the filter and active detection algorithms from Sidebar.tsx
function filterTree(nodes: NavNode[], hasPermission: (code: string) => boolean): NavNode[] {
  return nodes.flatMap((node) => {
    if (node.perm && !hasPermission(node.perm)) return [];
    const children = node.children ? filterTree(node.children, hasPermission) : undefined;
    if (node.children && children?.length === 0 && !node.href) return [];
    return [{ ...node, children }];
  });
}

function nodeContainsPath(node: NavNode, pathname: string): boolean {
  if (node.href && (pathname === node.href || pathname.startsWith(`${node.href}/`))) return true;
  return node.children?.some((child) => nodeContainsPath(child, pathname)) ?? false;
}

function collectActiveAncestors(nodes: NavNode[], pathname: string, ids = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (nodeContainsPath(node, pathname)) {
      ids.add(node.id);
      if (node.children) collectActiveAncestors(node.children, pathname, ids);
    }
  }
  return ids;
}

test('Tree Navigation: filterTree respects user permissions', () => {
  const tree: NavNode[] = [
    { id: 'inbox', label: '收件匣', href: '/dashboard/inbox' },
    { id: 'automation', label: '自動化', href: '/dashboard/automation', perm: 'automation.view' },
    {
      id: 'settings', label: '設定', href: '/dashboard/settings', children: [
        { id: 'settings-roles', label: '角色與權限', href: '/dashboard/settings/roles', perm: 'role.view' },
        { id: 'settings-a2a', label: 'A2A', href: '/dashboard/settings/a2a', perm: 'settings.manage' },
        { id: 'settings-general', label: '一般設定', href: '/dashboard/settings/general' },
      ],
    },
  ];

  // User without role.view or settings.manage
  const normalUserTree = filterTree(tree, (perm) => perm === 'automation.view');
  assert.equal(normalUserTree.some((n) => n.id === 'automation'), true);
  const settingsNode = normalUserTree.find((n) => n.id === 'settings');
  assert.ok(settingsNode?.children);
  assert.equal(settingsNode.children.some((c) => c.id === 'settings-roles'), false);
  assert.equal(settingsNode.children.some((c) => c.id === 'settings-a2a'), false);
  assert.equal(settingsNode.children.some((c) => c.id === 'settings-general'), true);

  // Admin user with all permissions
  const adminTree = filterTree(tree, () => true);
  const adminSettings = adminTree.find((n) => n.id === 'settings');
  assert.equal(adminSettings?.children?.length, 3);
});

test('Tree Navigation: collectActiveAncestors expands parents for child paths', () => {
  const tree: NavNode[] = [
    {
      id: 'knowledge', label: '知識庫', href: '/dashboard/knowledge', children: [
        { id: 'knowledge-articles', label: '文章管理', href: '/dashboard/knowledge/articles' },
        { id: 'knowledge-search', label: '語義搜尋', href: '/dashboard/knowledge/search' },
        {
          id: 'knowledge-ai', label: 'AI 設定', children: [
            { id: 'knowledge-embedding', label: 'Embedding', href: '/dashboard/knowledge/embedding' },
            { id: 'knowledge-chat', label: 'Chat & Prompt', href: '/dashboard/knowledge/chat-prompt' },
          ],
        },
      ],
    },
    {
      id: 'settings', label: '設定', href: '/dashboard/settings', children: [
        { id: 'settings-a2a', label: 'A2A', href: '/dashboard/settings/a2a' },
      ],
    },
  ];

  // When browsing /dashboard/knowledge/chat-prompt
  const activeIds = collectActiveAncestors(tree, '/dashboard/knowledge/chat-prompt');
  assert.equal(activeIds.has('knowledge'), true, 'Parent knowledge must be expanded');
  assert.equal(activeIds.has('knowledge-ai'), true, 'Sub-group knowledge-ai must be expanded');
  assert.equal(activeIds.has('knowledge-chat'), true, 'Leaf knowledge-chat is active');
  assert.equal(activeIds.has('settings'), false, 'Unrelated settings must not be expanded');
});

test('Tree Navigation: Parent with children distinguishes exact active from ancestor active', () => {
  const parentNode: NavNode = {
    id: 'knowledge',
    label: '知識庫',
    href: '/dashboard/knowledge',
    children: [
      { id: 'knowledge-search', label: '語義搜尋', href: '/dashboard/knowledge/search' },
    ],
  };

  const pathname = '/dashboard/knowledge/search';
  const hasChildren = Boolean(parentNode.children?.length);
  const isExact = parentNode.href ? pathname === parentNode.href : false;
  const isChildActive = parentNode.children?.some((child) => nodeContainsPath(child, pathname)) ?? false;
  const isDescendant = parentNode.href ? pathname.startsWith(`${parentNode.href}/`) : false;

  const isDirectActive = hasChildren ? isExact : (isExact || isDescendant);
  const isAncestorActive = hasChildren && (isChildActive || isDescendant);

  assert.equal(isDirectActive, false, 'Parent must not be direct active when browsing child');
  assert.equal(isAncestorActive, true, 'Parent must be ancestor active when browsing child');
});
