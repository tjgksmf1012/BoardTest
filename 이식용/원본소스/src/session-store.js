// 세션 저장소 (SQLite)
//
// express-session 은 아무 것도 지정하지 않으면 세션을 그 프로세스의 메모리에 담는다.
// 그래서 배포 로그에 "MemoryStore is not designed for a production environment" 경고가 뜬다.
// 실제로 걸리는 문제는 셋이다.
//   1) 만료된 세션이 메모리에서 사라지지 않아 오래 켜 둘수록 조금씩 쌓인다.
//   2) 프로세스가 둘 이상이면 서로 세션을 못 본다(요청마다 로그인 상태가 달라진다).
//   3) 서버를 다시 띄우면 세션이 전부 날아가 모두 로그아웃된다.
//      배포할 때마다, 그리고 무료 서버가 쉬었다 깨어날 때마다 그렇다.
// 세션을 이미 쓰고 있는 SQLite 에 두면 셋 다 해결된다.
const session = require('express-session');
const db = require('./db');

// expires_at 은 밀리초(Date.now() 기준) 숫자다.
// 다른 표처럼 문자열로 두면 만료를 지울 때마다 문자열 시각을 견줘야 해서
// 타임존 문제가 또 끼어든다. 세션은 사람이 읽을 일이 없으니 숫자가 낫다.
db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  sid        TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
`);

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 쿠키 설정이 없을 때만 쓰는 값
const GC_EVERY_MS = 60 * 60 * 1000;             // 만료 세션 청소 주기

// 이 세션이 언제까지 유효한지 — 쿠키에 적힌 만료를 그대로 따른다
function expiresAt(sess) {
  const c = sess && sess.cookie;
  if (c && c.expires) {
    const t = new Date(c.expires).getTime();
    if (!Number.isNaN(t)) return t;
  }
  if (c && typeof c.maxAge === 'number') return Date.now() + c.maxAge;
  return Date.now() + DEFAULT_TTL_MS;
}

class SqliteStore extends session.Store {
  constructor(options = {}) {
    super(options);
    this.q = {
      get: db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?'),
      set: db.prepare(
        `INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`
      ),
      touch: db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?'),
      del: db.prepare('DELETE FROM sessions WHERE sid = ?'),
      all: db.prepare('SELECT sid, data FROM sessions WHERE expires_at > ?'),
      count: db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?'),
      clear: db.prepare('DELETE FROM sessions'),
      gc: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    };
  }

  get(sid, cb) {
    try {
      const row = this.q.get.get(sid);
      if (!row) return cb(null, null);
      if (row.expires_at <= Date.now()) { // 기한이 지난 세션은 없는 것으로 치고 지운다
        this.q.del.run(sid);
        return cb(null, null);
      }
      return cb(null, JSON.parse(row.data));
    } catch (e) { return cb(e); }
  }

  set(sid, sess, cb) {
    try {
      this.q.set.run(sid, JSON.stringify(sess), expiresAt(sess));
      return cb(null);
    } catch (e) { return cb(e); }
  }

  // 로그인한 사람이 계속 돌아다니면 만료만 밀어준다 (본문은 그대로)
  touch(sid, sess, cb) {
    try {
      this.q.touch.run(expiresAt(sess), sid);
      return cb(null);
    } catch (e) { return cb(e); }
  }

  destroy(sid, cb) {
    try {
      this.q.del.run(sid);
      return cb(null);
    } catch (e) { return cb(e); }
  }

  length(cb) {
    try { return cb(null, this.q.count.get(Date.now()).n); } catch (e) { return cb(e); }
  }

  all(cb) {
    try {
      const out = {};
      for (const r of this.q.all.all(Date.now())) out[r.sid] = JSON.parse(r.data);
      return cb(null, out);
    } catch (e) { return cb(e); }
  }

  clear(cb) {
    try { this.q.clear.run(); return cb(null); } catch (e) { return cb(e); }
  }

  // 기한이 지난 세션 지우기. get 에서도 지우지만, 다시 찾아오지 않는 세션은
  // 아무도 읽지 않아 영영 남는다. 그래서 주기적으로 한 번씩 훑는다.
  sweep() {
    return this.q.gc.run(Date.now()).changes;
  }

  startGc(everyMs = GC_EVERY_MS) {
    this.sweep();
    const timer = setInterval(() => this.sweep(), everyMs);
    timer.unref(); // 테스트가 이 타이머 때문에 끝나지 않도록
    return timer;
  }
}

module.exports = { SqliteStore, expiresAt };
