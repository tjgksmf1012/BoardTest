// 레벨/업적 로직 테스트
const test = require('node:test');
const assert = require('node:assert');
const { getLevel, achievements } = require('../src/levels');

test('포인트에 따라 레벨이 올라간다', () => {
  assert.equal(getLevel(0).level, 1);
  assert.equal(getLevel(0).title, '새싹');
  assert.equal(getLevel(499).level, 1);
  assert.equal(getLevel(500).level, 2);
  assert.equal(getLevel(2000).level, 3);
  assert.equal(getLevel(5000).level, 4);
  assert.equal(getLevel(10000).level, 5);
  assert.equal(getLevel(20000).level, 6);
  assert.equal(getLevel(40000).level, 7);
  assert.equal(getLevel(999999).level, 7);
});

test('다음 레벨까지 진행률이 계산된다', () => {
  const l = getLevel(1250); // Lv.2(500) ~ Lv.3(2000) 사이, 절반
  assert.equal(l.level, 2);
  assert.equal(l.next.level, 3);
  assert.equal(l.percent, 50);
  assert.equal(l.toNext, 750);
});

test('최고 레벨은 다음 레벨이 없고 진행률 100%', () => {
  const l = getLevel(50000);
  assert.equal(l.next, null);
  assert.equal(l.percent, 100);
  assert.equal(l.toNext, 0);
});

test('업적은 조건 충족 시 earned가 된다', () => {
  const stats = { points: 0, posts: 1, comments: 0, likesReceived: 0, attendance: 0, popularPosts: 0, adminPicks: 0 };
  const list = achievements(stats);
  const first = list.find((a) => a.id === 'first_post');
  const writer = list.find((a) => a.id === 'writer');
  assert.equal(first.earned, true);
  assert.equal(writer.earned, false);
});

test('만렙 전설 업적은 40,000P 이상에서 달성', () => {
  const base = { posts: 0, comments: 0, likesReceived: 0, attendance: 0, popularPosts: 0, adminPicks: 0 };
  assert.equal(achievements({ ...base, points: 39999 }).find((a) => a.id === 'legend').earned, false);
  assert.equal(achievements({ ...base, points: 40000 }).find((a) => a.id === 'legend').earned, true);
});
