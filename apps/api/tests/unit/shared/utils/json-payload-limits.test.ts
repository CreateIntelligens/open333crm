/**
 * JSON 請求內容的掃描（change limit-request-array-size，spec request-payload-limits，issue #382）。
 * 掃描原始文字，不建立物件；超過上限時回傳違規內容與位置。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import {
  DEFAULT_JSON_PAYLOAD_LIMITS,
  findJsonPayloadViolation,
  type JsonPayloadLimits,
} from '#src/shared/utils/json-payload-limits.js';

const limits: JsonPayloadLimits = { maxArrayLength: 5, maxObjectKeys: 4, maxTotalEntries: 20, maxDepth: 4 };

function arr(n: number): string {
  return `[${Array.from({ length: n }, (_, i) => i).join(',')}]`;
}

describe('陣列元素過多的 JSON 請求在解析前被拒絕', () => {
  test('根層陣列超過上限', () => {
    assert.deepEqual(findJsonPayloadViolation(arr(6), limits), { kind: 'array', path: '', limit: 5 });
  });

  test('巢狀物件裡的陣列超過上限', () => {
    const text = `{"name":"x","items":[{"tags":${arr(6)}}]}`;
    assert.deepEqual(findJsonPayloadViolation(text, limits), { kind: 'array', path: 'items.0.tags', limit: 5 });
  });

  test('陣列中第二個元素裡的陣列超過上限時，位置指向第二個元素', () => {
    const text = `[[1],{"a":${arr(6)}}]`;
    assert.deepEqual(findJsonPayloadViolation(text, limits), { kind: 'array', path: '1.a', limit: 5 });
  });

  test('含跳脫字元的欄位名稱會解碼後放進位置', () => {
    const text = `{"a\\"b":${arr(6)}}`;
    assert.deepEqual(findJsonPayloadViolation(text, limits), { kind: 'array', path: 'a"b', limit: 5 });
  });

  test('陣列剛好等於上限', () => {
    assert.equal(findJsonPayloadViolation(arr(5), limits), null);
  });

  test('空陣列與空物件不計數', () => {
    assert.equal(findJsonPayloadViolation('{"a":[],"b":{},"c":[[],[]]}', limits), null);
  });

  test('字串裡的括號與逗號不計數', () => {
    const text = JSON.stringify({ s: ',[{'.repeat(20_000) + '\\"]' });
    assert.equal(findJsonPayloadViolation(text, DEFAULT_JSON_PAYLOAD_LIMITS), null);
  });

  test('字串裡跳脫的引號不會結束字串', () => {
    const text = JSON.stringify({ s: '"' + ','.repeat(100) + '"' });
    assert.equal(findJsonPayloadViolation(text, limits), null);
  });

  test('各種值的型別都算一個元素', () => {
    assert.equal(findJsonPayloadViolation('[1,"a",true,null,{}]', limits), null);
    assert.deepEqual(findJsonPayloadViolation('[1,"a",true,null,{},-2]', limits), { kind: 'array', path: '', limit: 5 });
  });
});

describe('物件欄位過多的 JSON 請求在解析前被拒絕', () => {
  test('物件欄位超過上限', () => {
    const text = `{"map":{"a":1,"b":2,"c":3,"d":4,"e":5}}`;
    assert.deepEqual(findJsonPayloadViolation(text, limits), { kind: 'object', path: 'map', limit: 4 });
  });

  test('物件欄位剛好等於上限', () => {
    assert.equal(findJsonPayloadViolation(`{"a":1,"b":2,"c":3,"d":4}`, limits), null);
  });
});

describe('元素總數過多的 JSON 請求在解析前被拒絕', () => {
  test('多個未超過單一上限的陣列合計超過總數上限', () => {
    // 4 個各 5 個元素的陣列（20）＋外層 4 個元素（4）＝ 24 > 20
    const text = `[${arr(5)},${arr(5)},${arr(5)},${arr(5)}]`;
    const v = findJsonPayloadViolation(text, limits);
    assert.equal(v?.kind, 'total');
    assert.equal(v?.limit, 20);
  });
});

describe('巢狀過深的 JSON 請求在解析前被拒絕', () => {
  test('巢狀深度超過上限', () => {
    assert.equal(findJsonPayloadViolation('[[[[1]]]]', limits), null);
    const v = findJsonPayloadViolation('[[[[[1]]]]]', limits);
    assert.equal(v?.kind, 'depth');
    assert.equal(v?.limit, 4);
  });

  test('極深的巢狀不讓 API 當掉', () => {
    const depth = 1_000_000;
    const text = '['.repeat(depth) + ']'.repeat(depth);
    const v = findJsonPayloadViolation(text, DEFAULT_JSON_PAYLOAD_LIMITS);
    assert.equal(v?.kind, 'depth');
    assert.equal(v?.limit, 64);
  });
});

test('預設上限', () => {
  assert.deepEqual(DEFAULT_JSON_PAYLOAD_LIMITS, {
    maxArrayLength: 10_000,
    maxObjectKeys: 10_000,
    maxTotalEntries: 100_000,
    maxDepth: 64,
  });
});
