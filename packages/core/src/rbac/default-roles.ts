/**
 * 三個 system role 的預設權限對照表（SPEC.md §5）
 *
 * 遷移零中斷原則：預設權限 = 現行三角色實際能做的事。
 * 標 ⚠ 的高風險權限（現行 AGENT 可用）預設仍給 AGENT 以維持零中斷，上線後由 Admin 收緊。
 *
 * 用途：
 * - seed：每租戶建三 system role 並種入這些權限
 * - 遷移：agent.role enum → roleId 對映（ADMIN→admin, SUPERVISOR→supervisor, AGENT→agent）
 */

import { PERMISSIONS } from './permissions';

/** 三個 system role 的 slug（固定、不可改） */
export const SYSTEM_ROLE_SLUGS = ['admin', 'supervisor', 'agent'] as const;
export type SystemRoleSlug = (typeof SYSTEM_ROLE_SLUGS)[number];

/** system role slug → 顯示名稱 */
export const SYSTEM_ROLE_NAMES: Record<SystemRoleSlug, string> = {
  admin: 'Admin',
  supervisor: 'Supervisor',
  agent: 'Agent',
};

/** 舊 AgentRole enum → system role slug */
export const ENUM_TO_SLUG: Record<string, SystemRoleSlug> = {
  ADMIN: 'admin',
  SUPERVISOR: 'supervisor',
  AGENT: 'agent',
};

// admin 一律擁有全部權限（含平台鎖定核心）
const ALL_CODES = PERMISSIONS.map((p) => p.code);

// supervisor 預設權限（= 現行 SUPERVISOR 能力 + 分析/行銷/渠道檢視等）
const SUPERVISOR_CODES = [
  // 客服作業（登入即可 → 給）
  'inbox.view', 'inbox.reply', 'inbox.manage',
  'case.view', 'case.create', 'case.update', 'case.assign', 'case.escalate', 'case.delete',
  'contact.view', 'contact.update', 'contact.merge',
  'tag.view', 'tag.manage',
  'knowledge.view', 'knowledge.manage', 'knowledge.admin',
  'shortlink.view', 'shortlink.manage',
  'canvas.use', 'identity.review',
  // SUPERVISOR 級
  'automation.view',
  'channel.view', 'richmenu.manage', 'quickreply.manage',
  'marketing.view', 'marketing.manage', 'marketing.broadcast',
  'analytics.view', 'analytics.view.self', 'analytics.export',
  'settings.manage', 'sla.manage', 'webhook.view',
  'agent.view', 'agent.manage', 'agent.role.assign',
  'billing.view',
];

// agent 預設權限（= 現行 AGENT「登入即可」的能力）
const AGENT_CODES = [
  'inbox.view', 'inbox.reply', 'inbox.manage',
  'case.view', 'case.create', 'case.update', 'case.assign', 'case.escalate', 'case.delete',
  'contact.view', 'contact.update', 'contact.merge',
  'tag.view', 'tag.manage',
  'knowledge.view', 'knowledge.manage',
  'shortlink.view', 'shortlink.manage',
  'canvas.use', 'identity.review',
  'analytics.view.self',
  'agent.view',
];

/** system role slug → 預設權限碼陣列 */
export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRoleSlug, string[]> = {
  admin: ALL_CODES,
  supervisor: SUPERVISOR_CODES,
  agent: AGENT_CODES,
};
