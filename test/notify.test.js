// 알림 로직 테스트
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'boardtest-noti-')), 'test.db');

const db = require('../src/db');
const { notify, unreadCount } = require('../src/notify');

let seq = 0;
function makeUser() {
  seq += 1;
  return db.prepare(
    "INSERT INTO users (username, password_hash, nickname) VALUES (?, 'x', ?)"
  ).run(`u${seq}`, `유저${seq}`).lastInsertRowid;
}

test('알림이 생성되고 안 읽은 수가 집계된다', () => {
  const a = makeUser();
  const b = makeUser();
  notify(a, b, '테스트 알림', '/board/1');
  notify(a, b, '두번째 알림', '/board/2');
  assert.equal(unreadCount(a), 2);
});

test('자기 자신에게는 알림이 가지 않는다', () => {
  const a = makeUser();
  notify(a, a, '내가 내 글에 단 댓글', '/board/1');
  assert.equal(unreadCount(a), 0);
});

test('읽음 처리하면 안 읽은 수가 줄어든다', () => {
  const a = makeUser();
  const b = makeUser();
  notify(a, b, '알림', '/board/1');
  assert.equal(unreadCount(a), 1);
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(a);
  assert.equal(unreadCount(a), 0);
});
