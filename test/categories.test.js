// 카테고리(말머리) 검증 테스트
const test = require('node:test');
const assert = require('node:assert');
const { CATEGORIES, isValid, catTag } = require('../src/categories');

test('정의된 말머리만 유효하다', () => {
  assert.equal(isValid('자유'), true);
  assert.equal(isValid('구인구직'), true);
  assert.equal(isValid('없는카테고리'), false);
  assert.equal(isValid(''), false);
  assert.equal(isValid(undefined), false);
});

test('말머리 5종이 정의되어 있다', () => {
  assert.equal(CATEGORIES.length, 5);
});

test('유효한 말머리는 태그 HTML을, 잘못된 값은 빈 문자열을 반환', () => {
  assert.match(catTag('질문'), /질문/);
  assert.equal(catTag('없는거'), '');
});
