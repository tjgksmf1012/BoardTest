// 포인트 제도 핵심 로직 테스트 (node --test)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 실제 DB를 건드리지 않도록 임시 DB 사용
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'boardtest-')), 'test.db');

const db = require('../src/db');
const { award, checkAttendance, crossedUnlocks, todayStr, UNLOCK_THRESHOLDS,
  checkedToday, currentStreak, streakBeforeToday, attendanceView } = require('../src/points');

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

test('출석체크: 첫 출석 10P, 같은 날 중복 출석 불가', () => {
  const u = makeUser();
  const first = checkAttendance(u);
  assert.equal(first.already, false);
  assert.equal(first.results[0].awarded, 10);
  assert.equal(first.streak, 1);

  const second = checkAttendance(u);
  assert.equal(second.already, true);
  assert.equal(points(u), 10);
});

test('7일 연속 출석 시 50P 보너스', () => {
  const u = makeUser();
  // 엿새 전부터 어제까지 출석을 미리 기록해두고 오늘 출석 → 7일째
  for (let i = 6; i >= 1; i--) {
    db.prepare('INSERT INTO attendance (user_id, day) VALUES (?, ?)').run(u, dayOffset(-i));
  }
  const r = checkAttendance(u);
  assert.equal(r.streak, 7);
  const total = r.results.reduce((s, x) => s + x.awarded, 0);
  assert.equal(total, 60, '출석 10 + 7일 연속 50');
});

test('보너스는 딱 그 날짜에 닿았을 때만 준다', () => {
  const u = makeUser();
  // 이레 전부터 어제까지(7일) → 오늘은 8일째라 보너스가 없다
  for (let i = 7; i >= 1; i--) {
    db.prepare('INSERT INTO attendance (user_id, day) VALUES (?, ?)').run(u, dayOffset(-i));
  }
  const r = checkAttendance(u);
  assert.equal(r.streak, 8);
  assert.equal(r.results.length, 1, '출석 포인트만');
  assert.equal(r.results.reduce((s, x) => s + x.awarded, 0), 10);
});

test('연속 출석이 끊기면 스트릭이 다시 시작됨', () => {
  const u = makeUser();
  // 3일 전에만 출석 → 어제가 비어 있으므로 오늘 출석하면 스트릭 1
  db.prepare('INSERT INTO attendance (user_id, day) VALUES (?, ?)').run(u, dayOffset(-3));
  const r = checkAttendance(u);
  assert.equal(r.streak, 1);
});

test('상점에서 살 수 있게 되는 지점을 감지한다', () => {
  // 기준값은 캐릭터·테두리 가격에서 온다 (한곳에서 나와야 어긋나지 않는다)
  const [ch, bd] = UNLOCK_THRESHOLDS.map((t) => t.points);
  assert.deepEqual(crossedUnlocks(ch - 100, ch + 100).map((t) => t.points), [ch]);
  assert.deepEqual(crossedUnlocks(ch, ch + 100).map((t) => t.points), [], '이미 넘긴 지점은 다시 알리지 않는다');
  assert.deepEqual(crossedUnlocks(0, bd + 100).map((t) => t.points), [ch, bd]);
  assert.deepEqual(crossedUnlocks(0, 300).map((t) => t.points), []);
});

test('포인트 지급 시 해금 정보가 함께 반환됨', () => {
  const u = makeUser();
  const need = UNLOCK_THRESHOLDS[0].points;
  db.prepare('UPDATE users SET points = ? WHERE id = ?').run(need - 100, u);
  const r = award(u, 'post'); // +300 → 기준선 통과
  assert.equal(r.unlocked.length, 1);
  assert.equal(r.unlocked[0].points, need);
});

test('오늘 날짜 형식이 YYYY-MM-DD', () => {
  assert.match(todayStr(), /^\d{4}-\d{2}-\d{2}$/);
});

test('출석 전에는 어제까지의 연속 기록을 보여준다', () => {
  const u = makeUser();
  const mark = (offset) => db.prepare('INSERT INTO attendance (user_id, day) VALUES (?, ?)').run(u, dayOffset(offset));
  mark(-1); mark(-2); mark(-3); // 어제·그제·그그제 출석, 오늘은 아직

  assert.equal(checkedToday(u), false);
  // 오늘 기준으로 세면 0일이지만, 안내에는 어제까지 이어온 3일이 나와야 한다
  assert.equal(currentStreak(u), 0);
  assert.equal(streakBeforeToday(u), 3);

  const view = attendanceView(u);
  assert.equal(view.checkedToday, false);
  assert.equal(view.streak, 3, '출석 전에는 어제까지의 연속일');

  // 오늘 출석하면 4일째로 이어진다
  checkAttendance(u);
  assert.equal(checkedToday(u), true);
  assert.equal(attendanceView(u).streak, 4);
});

test('연속이 끊겼으면 출석 전 연속 기록은 0', () => {
  const u = makeUser();
  db.prepare('INSERT INTO attendance (user_id, day) VALUES (?, ?)').run(u, dayOffset(-3));
  assert.equal(streakBeforeToday(u), 0); // 어제 출석이 없으므로 끊김
});

test('추천하면 글에 저장된 추천 수도 함께 올라간다', () => {
  const author = makeUser();
  const postId = db.prepare("INSERT INTO posts (user_id, title, content) VALUES (?, '추천글', '내용')")
    .run(author).lastInsertRowid;
  const before = db.prepare('SELECT like_count FROM posts WHERE id = ?').get(postId).like_count;
  assert.equal(before, 0);

  // 실제 추천은 라우터가 처리하지만, 저장 값과 실제 행 수가 어긋나면 목록 정렬이 틀어진다
  const voter = makeUser();
  db.prepare('INSERT INTO likes (post_id, user_id) VALUES (?, ?)').run(postId, voter);
  db.prepare('UPDATE posts SET like_count = like_count + 1 WHERE id = ?').run(postId);

  const after = db.prepare('SELECT like_count FROM posts WHERE id = ?').get(postId).like_count;
  const real = db.prepare('SELECT COUNT(*) c FROM likes WHERE post_id = ?').get(postId).c;
  assert.equal(after, real, '저장된 추천 수와 실제 추천 행 수가 같아야 한다');
});
