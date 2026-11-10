/**
 * 平台稽核紀錄的顯示規則（change add-platform-tenant-audit-logs，規格 platform-audit-log
 * 「平台稽核動作以中文名稱顯示」「稽核紀錄的對象顯示可讀名稱並連到對應頁面」）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  auditActionLabel,
  auditTargetHref,
  auditTargetText,
} from '#src/app/admin/lib/audit-log.js';

/** 規格列出的所有平台稽核動作 */
const PLATFORM_ACTIONS = [
  'platform_user.provision',
  'platform_user.update',
  'platform_user.enable',
  'platform_user.disable',
  'platform_user.resend_welcome',
  'platform_user.change_password',
  'tenant.provision',
  'tenant.update',
  'tenant.enable',
  'tenant.disable',
  'tenant.contract.update',
  'tenant.agent.email.update',
  'tenant.agent.resend_welcome',
  'tenant.ai_privacy.update',
  'tenant.trial.extend',
  'tenant.trial.convert',
  'tenant.trial.restore',
  'tenant.trial.expire',
  'tenant.trial.purge',
  'trial.signup.fail',
  'plan.update',
  'plan_change.approve',
  'plan_change.reject',
  'plan_change.notify_platform',
  'setting.update',
  'queue.job.retry',
];

test('已知動作顯示中文', () => {
  const missing = PLATFORM_ACTIONS.filter((a) => auditActionLabel(a) === a || /[a-z_]+\.[a-z_]+/.test(auditActionLabel(a)));
  assert.deepEqual(missing, []);
});

test('未知動作顯示代碼', () => {
  assert.equal(auditActionLabel('foo.bar'), 'foo.bar');
});

test('對象連到租戶頁', () => {
  const entry = { targetType: 'agent', targetId: 'agent-1', targetLabel: 'a@example.com', targetTenantId: 'T' };
  assert.equal(auditTargetText(entry), 'a@example.com');
  assert.equal(auditTargetHref(entry), '/admin/tenants/T');
  assert.equal(auditTargetHref({ ...entry, targetType: 'tenant' }), '/admin/tenants/T');
  assert.equal(auditTargetHref({ ...entry, targetType: 'plan_change_request' }), '/admin/tenants/T');
  assert.equal(auditTargetHref({ targetType: 'plan', targetId: 'p', targetTenantId: null }), '/admin/plans');
  assert.equal(
    auditTargetHref({ targetType: 'platform_user', targetId: 'u1', targetTenantId: null }),
    '/admin/platform-users/u1',
  );
  assert.equal(auditTargetHref({ targetType: 'trial_signup', targetId: 's', targetTenantId: null }), '/admin/trial');
  assert.equal(auditTargetHref({ targetType: 'setting', targetId: 'k', targetTenantId: null }), null);
});

test('查不到名稱時退回代碼', () => {
  assert.equal(
    auditTargetText({ targetType: 'plan', targetId: '33333333-3333-4333-8333-333333333333', targetLabel: null }),
    'plan / 33333333…',
  );
  assert.equal(auditTargetText({ targetType: null, targetId: null, targetLabel: null }), '—');
});
