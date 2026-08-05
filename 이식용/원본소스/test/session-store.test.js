// 세션 저장소 테스트
// 기본값(메모리)은 서버를 다시 띄우면 로그인이 전부 풀린다. SQLite 에 담아 그러지 않게 했고,
// 여기서는 담기고·읽히고·만료되고·지워지는지를 확인한다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'boardtest-sess-')), 'test.db');

const db = require('../src/db');
const { SqliteStore } = require('../src/session-store');

const store = new SqliteStore();
const call = (fn, ...args) => new Promise((resolve, reject) => {
  store[fn](...args, (err, val) => (err ? reject(err) : resolve(val)));
});
const sess = (userId, maxAge = 60000) => ({ cookie: { maxAge, expires: new Date(Date.now() + maxAge) }, userId });

test('저장한 세션을 다시 읽을 수 있다', async () => {
  await call('set', 's1', sess(7));
  const got = await call('get', 's1');
  assert.equal(got.userId, 7);
});

test('없는 세션은 null 이다 (오류가 아니라)', async () => {
  assert.equal(await call('get', '없는키'), null);
});

test('같은 sid 로 다시 저장하면 덮어쓴다', async () => {
  await call('set', 's2', sess(1));
  await call('set', 's2', sess(2));
  assert.equal((await call('get', 's2')).userId, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE sid = ?').get('s2').n, 1);
});

test('기한이 지난 세션은 읽히지 않고 그 자리에서 지워진다', async () => {
  await call('set', 's3', sess(5));
  db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(Date.now() - 1000, 's3');
  assert.equal(await call('get', 's3'), null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE sid = ?').get('s3').n, 0);
});

test('touch 는 만료만 미루고 내용은 건드리지 않는다', async () => {
  await call('set', 's4', sess(9, 1000));
  const before = db.prepare('SELECT expires_at FROM sessions WHERE sid = ?').get('s4').expires_at;
  await call('touch', 's4', sess(9, 600000));
  const after = db.prepare('SELECT expires_at FROM sessions WHERE sid = ?').get('s4');
  assert.ok(after.expires_at > before);
  assert.equal((await call('get', 's4')).userId, 9);
});

test('destroy 하면 사라진다 (로그아웃)', async () => {
  await call('set', 's5', sess(3));
  await call('destroy', 's5');
  assert.equal(await call('get', 's5'), null);
});

test('sweep 은 기한 지난 것만 지운다', async () => {
  await call('set', 'live', sess(1));
  await call('set', 'dead', sess(2));
  db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(Date.now() - 1, 'dead');
  store.sweep();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE sid = ?').get('dead').n, 0);
  assert.ok((await call('get', 'live')).userId === 1);
});

test('length 는 살아 있는 세션만 센다', async () => {
  await call('clear');
  await call('set', 'a', sess(1));
  await call('set', 'b', sess(2));
  db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(Date.now() - 1, 'b');
  assert.equal(await call('length'), 1);
});

test('서버를 다시 띄워도 세션이 남아 있다 (저장소를 새로 만들어도 읽힌다)', async () => {
  await call('set', 'keep', sess(42));
  const fresh = new SqliteStore();
  const got = await new Promise((res, rej) => fresh.get('keep', (e, v) => (e ? rej(e) : res(v))));
  assert.equal(got.userId, 42);
});
