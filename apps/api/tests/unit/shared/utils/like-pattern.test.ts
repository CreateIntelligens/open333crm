/**
 * escapeLikeKeyword：使用者輸入的 `%`、`_`、反斜線要當成一般文字（#467）。
 * 實際交給 PostgreSQL ILIKE 的比對結果在 tests/feature/modules/like-escape-search.test.ts 驗證。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { escapeLikeKeyword } from '#src/shared/utils/like-pattern.js';

describe('escapeLikeKeyword', () => {
  it('沒有特殊字元時原樣回傳', () => {
    assert.equal(escapeLikeKeyword('王小明 abc-123@x.com'), '王小明 abc-123@x.com');
  });

  it('空字串回傳空字串', () => {
    assert.equal(escapeLikeKeyword(''), '');
  });

  it('跳脫 % 與 _', () => {
    assert.equal(escapeLikeKeyword('a_1'), 'a\\_1');
    assert.equal(escapeLikeKeyword('100%'), '100\\%');
    assert.equal(escapeLikeKeyword('%_%'), '\\%\\_\\%');
  });

  it('反斜線也跳脫，避免使用者的反斜線吃掉下一個字元', () => {
    assert.equal(escapeLikeKeyword('C:\\dir'), 'C:\\\\dir');
  });

  it('反斜線後接 % 時兩者各自跳脫（先跳脫反斜線，不會變成跳脫後的 %）', () => {
    assert.equal(escapeLikeKeyword('\\%'), '\\\\\\%');
  });

  it('不改動其他 LIKE 以外的正規表示式字元', () => {
    assert.equal(escapeLikeKeyword('a.b*c[d]'), 'a.b*c[d]');
  });
});
