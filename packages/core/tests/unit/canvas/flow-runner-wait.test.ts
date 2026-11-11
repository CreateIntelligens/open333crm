/**
 * 等待節點喚醒後從下一個節點繼續（issue #334，change fix-canvas-wait-resume，spec interaction-canvas）。
 *
 * FlowRunner 目前用 module-level 的 prisma singleton（AUDIT RLS-01），這裡以記憶體中的資料取代它；
 * EventBus 換成記錄發布內容的替身，不連 Redis。真實資料庫的整條路徑（排程認領 → FlowRunner）
 * 見 apps/api/tests/feature/modules/canvas/canvas-resume.test.ts。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

interface Node {
  id: string;
  flowId: string;
  nodeType: string;
  label: string;
  config: Record<string, unknown>;
  nextNodeId: string | null;
  falseNodeId: string | null;
  sortOrder: number;
}

const state = vi.hoisted(() => ({
  execution: null as null | Record<string, unknown>,
  nodes: [] as Node[],
  logs: [] as Array<{ nodeId: string | null; action: string }>,
  published: [] as Array<{ type: string; payload: Record<string, unknown> }>,
}));

vi.mock('@open333crm/database', () => ({
  prisma: {
    flowExecution: {
      findUniqueOrThrow: async () => ({
        ...state.execution,
        flow: { maxStepLimit: 100, nodes: state.nodes },
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.execution = { ...state.execution, ...data };
        return state.execution;
      },
    },
    flowLog: {
      create: async ({ data }: { data: { nodeId: string | null; action: string } }) => {
        state.logs.push({ nodeId: data.nodeId, action: data.action });
        return data;
      },
    },
  },
}));

vi.mock('#src/event-bus/event-bus.js', () => ({
  EventBus: {
    publish: async (event: { type: string; payload: Record<string, unknown> }) => {
      state.published.push(event);
    },
  },
}));

// 等待節點只靠資料庫輪詢喚醒（AUDIT APP-07）；這裡不測 BullMQ 的分支
vi.mock('#src/canvas/scheduler.js', () => ({ scheduleWaitNode: async () => {} }));

const { FlowRunner } = await import('#src/canvas/flow-runner.js');

const FLOW = 'f0000000-0000-0000-0000-000000000001';

function node(id: string, nodeType: string, nextNodeId: string | null, config: Record<string, unknown> = {}): Node {
  return { id, flowId: FLOW, nodeType, label: id, config, nextNodeId, falseNodeId: null, sortOrder: 0 };
}

function startExecution(nodes: Node[]) {
  state.nodes = nodes;
  state.execution = {
    id: 'e1',
    flowId: FLOW,
    contactId: 'c1',
    tenantId: 't1',
    status: 'RUNNING',
    currentNodeId: null,
    contextVars: {},
    stepCount: 0,
    resumeAt: null,
  };
}

/** processResumeQueue 認領成功後的狀態：RUNNING、resumeAt 清空，currentNodeId 不變 */
function claim() {
  assert.equal(state.execution?.status, 'WAITING');
  state.execution = { ...state.execution, status: 'RUNNING', resumeAt: null };
}

const entered = () => state.logs.filter((l) => l.action === 'node_entered').map((l) => l.nodeId);
const waitsScheduled = () => state.logs.filter((l) => l.action === 'wait_scheduled').map((l) => l.nodeId);
const messages = () => state.published.filter((e) => e.type === 'canvas.send_message').map((e) => e.payload.text);

beforeEach(() => {
  state.logs = [];
  state.published = [];
});

test('喚醒後從等待節點的下一個節點繼續', async () => {
  startExecution([
    node('trigger', 'TRIGGER', 'wait'),
    node('wait', 'WAIT', 'msg', { delayMinutes: 60 }),
    node('msg', 'MESSAGE', null, { channelType: 'LINE', text: 'hello' }),
  ]);

  await FlowRunner.run('e1');
  assert.equal(state.execution?.status, 'WAITING');
  assert.ok(state.execution?.resumeAt instanceof Date);
  assert.deepEqual(messages(), [], '等待之前不應該送出訊息');

  claim();
  await FlowRunner.run('e1', { resumeFromWait: true });

  assert.equal(state.execution?.status, 'COMPLETED', `喚醒後應該完成，實際 ${String(state.execution?.status)}`);
  assert.deepEqual(waitsScheduled(), ['wait'], '同一個等待節點只能排程一次');
  assert.deepEqual(messages(), ['hello']);
  assert.deepEqual(entered(), ['trigger', 'wait', 'msg']);
});

test('等待節點是最後一個節點時，喚醒後流程完成，不從頭開始', async () => {
  startExecution([node('trigger', 'TRIGGER', 'wait'), node('wait', 'WAIT', null, { delayMs: 1000 })]);

  await FlowRunner.run('e1');
  claim();
  await FlowRunner.run('e1', { resumeFromWait: true });

  assert.equal(state.execution?.status, 'COMPLETED');
  assert.deepEqual(entered(), ['trigger', 'wait']);
  assert.ok(state.published.some((e) => e.type === 'flow.completed'));
});

test('連續兩個等待節點：每次喚醒前進一個等待節點', async () => {
  startExecution([
    node('trigger', 'TRIGGER', 'wait1'),
    node('wait1', 'WAIT', 'wait2', { delayMs: 1000 }),
    node('wait2', 'WAIT', 'msg', { delayMs: 1000 }),
    node('msg', 'MESSAGE', null, { channelType: 'LINE', text: 'done' }),
  ]);

  await FlowRunner.run('e1');
  claim();
  await FlowRunner.run('e1', { resumeFromWait: true });
  assert.equal(state.execution?.status, 'WAITING');
  assert.equal(state.execution?.currentNodeId, 'wait2');
  assert.deepEqual(messages(), []);

  claim();
  await FlowRunner.run('e1', { resumeFromWait: true });
  assert.equal(state.execution?.status, 'COMPLETED');
  assert.deepEqual(waitsScheduled(), ['wait1', 'wait2']);
  assert.deepEqual(messages(), ['done']);
});
