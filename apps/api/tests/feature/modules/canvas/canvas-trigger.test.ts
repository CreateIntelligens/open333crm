/**
 * 手動觸發只接受本租戶啟用中的流程與本租戶的聯絡人（change migrate-canvas-tenant-ctx，spec interaction-canvas）。
 *
 * 流程引擎以 spy 取代：這裡只檢查觸發建立了什麼、有沒有開始執行，不執行節點。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, test, vi } from 'vitest';
import { FlowRunner } from '@open333crm/core';
import { call, createCanvasFixture } from './canvas-test-app.js';

const fx = await createCanvasFixture('trigger');
afterAll(() => fx.cleanup());

const appA = await fx.buildApp(fx.A, 'manager');
const appNoPermission = await fx.buildApp(fx.A, 'inbox-only', ['inbox.view']);
const activeA = await fx.flowOf(fx.A, 'ACTIVE', 'active-a');
const draftA = await fx.flowOf(fx.A, 'DRAFT', 'draft-a');
const archivedA = await fx.flowOf(fx.A, 'ARCHIVED', 'archived-a');
const activeB = await fx.flowOf(fx.B, 'ACTIVE', 'active-b');
const contactA = await fx.contactOf(fx.A, 'contact-a');
const contactB = await fx.contactOf(fx.B, 'contact-b');

const runSpy = vi.spyOn(FlowRunner, 'run');
beforeEach(() => {
  runSpy.mockReset();
  runSpy.mockResolvedValue(undefined);
});

const trigger = (app: typeof appA, flowId: string, contactId: string) =>
  call(app, 'POST', `/api/v1/canvas/${flowId}/trigger`, { contactId });

/** 這個流程或這位聯絡人在任何租戶的 execution 數 */
const executionsOf = (where: { flowId?: string; contactId?: string }) => fx.owner.flowExecution.count({ where });

describe('手動觸發只接受本租戶啟用中的流程與本租戶的聯絡人', () => {
  test('觸發啟用中的流程', async () => {
    const res = await trigger(appA, activeA.id, contactA.id);
    assert.equal(res.status, 202);
    const executionId = res.body.data.executionId as string;
    const execution = await fx.owner.flowExecution.findUniqueOrThrow({ where: { id: executionId } });
    assert.equal(execution.tenantId, fx.A);
    assert.equal(execution.flowId, activeA.id);
    assert.equal(execution.contactId, contactA.id);
    assert.equal(execution.status, 'RUNNING');
  });

  test('觸發另一個租戶的流程', async () => {
    const res = await trigger(appA, activeB.id, contactA.id);
    assert.equal(res.status, 404);
    assert.equal(await executionsOf({ flowId: activeB.id }), 0);
    assert.equal(runSpy.mock.calls.length, 0);
  });

  test('觸發不存在的流程', async () => {
    const missing = randomUUID();
    const res = await trigger(appA, missing, contactA.id);
    assert.equal(res.status, 404);
    assert.equal(await executionsOf({ flowId: missing }), 0);
    assert.equal(runSpy.mock.calls.length, 0);
  });

  test('觸發草稿或封存的流程', async () => {
    for (const flow of [draftA, archivedA]) {
      const res = await trigger(appA, flow.id, contactA.id);
      assert.equal(res.status, 409, flow.status);
      assert.equal(res.body.error?.code, 'FLOW_NOT_ACTIVE', flow.status);
      assert.equal(await executionsOf({ flowId: flow.id }), 0, flow.status);
    }
    assert.equal(runSpy.mock.calls.length, 0);
  });

  test('聯絡人屬於另一個租戶', async () => {
    const res = await trigger(appA, activeA.id, contactB.id);
    assert.equal(res.status, 404);
    assert.equal(await executionsOf({ contactId: contactB.id }), 0);
    assert.equal(runSpy.mock.calls.length, 0);
  });

  test('聯絡人不存在', async () => {
    const missing = randomUUID();
    const res = await trigger(appA, activeA.id, missing);
    assert.equal(res.status, 404);
    assert.equal(await executionsOf({ contactId: missing }), 0);
    assert.equal(runSpy.mock.calls.length, 0);
  });

  test('沒有權限', async () => {
    const before = await executionsOf({ flowId: activeA.id });
    const res = await trigger(appNoPermission, activeA.id, contactA.id);
    assert.equal(res.status, 403);
    assert.equal(await executionsOf({ flowId: activeA.id }), before);
    assert.equal(runSpy.mock.calls.length, 0);
  });
});

describe('手動觸發在 execution commit 之後才開始執行', () => {
  test('commit 之後開始執行', async () => {
    // 引擎用另一條連線讀 execution，與真實的引擎相同（singleton）：commit 之前讀不到
    const seen: Array<string | null> = [];
    runSpy.mockImplementation(async (executionId: string) => {
      const row = await fx.owner.flowExecution.findUnique({ where: { id: executionId }, select: { id: true } });
      seen.push(row?.id ?? null);
    });

    const res = await trigger(appA, activeA.id, contactA.id);
    assert.equal(res.status, 202);
    const executionId = res.body.data.executionId as string;
    await vi.waitFor(() => assert.equal(seen.length, 1));
    assert.deepEqual(seen, [executionId]);
    assert.equal(runSpy.mock.calls.length, 1);
  });
});
