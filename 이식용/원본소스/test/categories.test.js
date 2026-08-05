// 카테고리(말머리) 검증 테스트
const test = require('node:test');
const assert = require('node:assert');
const { CATEGORIES, RETIRED, isValid, normalize, catTag } = require('../src/categories');

test('정의된 말머리만 유효하다', () => {
  assert.equal(isValid('자유'), true);
  assert.equal(isValid('이벤트'), true);
  assert.equal(isValid('구인구직'), false, '없앤 말머리로는 새 글을 쓸 수 없다');
  assert.equal(isValid('없는카테고리'), false);
  assert.equal(isValid(''), false);
  assert.equal(isValid(undefined), false);
});

test('말머리는 자유·질문·정보·이벤트 4종이다', () => {
  assert.deepEqual(CATEGORIES.map((c) => c.id), ['자유', '질문', '정보', '이벤트']);
});

test('없앤 말머리로 저장된 옛 글은 자유로 읽는다', () => {
  // 데이터를 지우지 않고 표시만 옮긴다 — 옛 글이 어느 탭에도 안 걸리면 사라진 것처럼 보인다
  for (const old of Object.keys(RETIRED)) assert.equal(normalize(old), '자유');
  assert.equal(normalize('질문'), '질문', '살아있는 말머리는 그대로');
  assert.equal(normalize(undefined), '자유');
});

test('유효한 말머리는 태그 HTML을, 잘못된 값은 빈 문자열을 반환', () => {
  assert.match(catTag('질문'), /질문/);
  assert.equal(catTag('없는거'), '');
});
