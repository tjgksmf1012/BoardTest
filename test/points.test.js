// 포인트 제도 핵심 로직 테스트 (node --test)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 실제 DB를 건드리지 않도록 임시 DB 사용
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'boardtest-')), 'test.db');

const db = require('../src/db');
const { award, checkAttendance, crossedUnlocks, todayStr } = require('../src/points');

let seq = 0;
function makeUser() {
  seq += 1;
  return db.prepare(
    "INSERT INTO users (username, password_hash, nickname) VALUES (?, 'x', ?)"
  ).run(`user${seq}`, `유저${seq}`).lastInsertRowid;
}

function points(userId) {
  return db.prepare('SELECT points FROM users WHERE id = ?').get(userId).points;
}

function dayOffset(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

test('회원가입 포인트 1,000P 지급', () => {
  const u = makeUser();
  const r = award(u, 'signup');
  assert.equal(r.awarded, 1000);
  assert.equal(points(u), 1000);
  const log = db.prepare("SELECT * FROM point_logs WHERE user_id = ? AND reason = 'signup'").get(u);
  assert.ok(log);
  assert.equal(log.amount, 1000);
});

test('일반 게시글은 하루 3개까지만 300P 지급', () => {
  const u = makeUser();
  for (let i = 0; i < 3; i++) {
    assert.equal(award(u, 'post').awarded, 300);
  }
  const fourth = award(u, 'post');
  assert.equal(fourth.awarded, 0);
  assert.equal(fourth.limited, true);
  assert.equal(points(u), 900);
});

test('익명 게시글은 하루 3개까지만 100P 지급', () => {
  const u = makeUser();
  for (let i = 0; i < 3; i++) {
    assert.equal(award(u, 'anon_post').awarded, 100);
  }
  assert.equal(award(u, 'anon_post').limited, true);
  assert.equal(points(u), 300);
});

test('댓글은 하루 10개까지만 100P 지급', () => {
  const u = makeUser();
  for (let i = 0; i < 10; i++) {
    assert.equal(award(u, 'comment').awarded, 100);
  }
  assert.equal(award(u, 'comment').limited, true);
  assert.equal(points(u), 1000);
});

test('추천받기는 한도 없이 10P씩 적립', () => {
  const u = makeUser();
  for (let i = 0; i < 15; i++) {
    assert.equal(award(u, 'like_received').awarded, 10);
  }
  assert.equal(points(u), 150);
});

test('출석체크: 첫 출석 100P, 같은 날 중복 출석 불가', () => {
  const u = makeUser();
  const first = checkAttendance(u);
  assert.equal(first.already, false);
  assert.equal(first.results[0].awarded, 100);
  assert.equal(first.streak, 1);

  const second = checkAttendance(u);
  assert.equal(second.already, true);
  assert.equal(points(u), 100);
});

test('3일 연속 출석 시 500P 보너스', () => {
  const u = makeUser();
  // 이틀 전, 어제 출석을 미리 기록해두고 오늘 출석
  db.prepare('INSERT INTO attendance (user_id, day) VALUES (?, ?)').run(u, dayOffset(-2));
  db.prepare('INSERT INTO attendance (user_id, day) VALUES (?, ?)').run(u, dayOffset(-1));

  const r = checkAttendance(u);
  assert.equal(r.streak, 3);
  const total = r.results.reduce((s, x) => s + x.awarded, 0);
  assert.equal(total, 600); // 출석 100 + 3일 연속 500
});

test('연속 출석이 끊기면 스트릭이 다시 시작됨', () => {
  const u = makeUser();
  // 3일 전에만 출석 → 어제가 비어 있으므로 오늘 출석하면 스트릭 1
  db.prepare('INSERT INTO attendance (user_id, day) VALUES (?, ?)').run(u, dayOffset(-3));
  const r = checkAttendance(u);
  assert.equal(r.streak, 1);
});

test('아바타 해금 기준 통과 감지', () => {
  assert.deepEqual(crossedUnlocks(4900, 5200).map((t) => t.points), [5000]);
  assert.deepEqual(crossedUnlocks(5000, 5100).map((t) => t.points), []);
  assert.deepEqual(crossedUnlocks(9000, 21000).map((t) => t.points), [10000, 20000]);
  assert.deepEqual(crossedUnlocks(0, 300).map((t) => t.points), []);
});

test('포인트 지급 시 해금 정보가 함께 반환됨', () => {
  const u = makeUser();
  db.prepare('UPDATE users SET points = 4900 WHERE id = ?').run(u);
  const r = award(u, 'post'); // 4900 + 300 = 5200 → 5000 통과
  assert.equal(r.unlocked.length, 1);
  assert.equal(r.unlocked[0].points, 5000);
});

test('오늘 날짜 형식이 YYYY-MM-DD', () => {
  assert.match(todayStr(), /^\d{4}-\d{2}-\d{2}$/);
});
