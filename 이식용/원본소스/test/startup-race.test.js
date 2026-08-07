// 서버 두 대가 같은 DB 파일로 동시에 뜰 수 있는가
//
// 왜 이걸 보나
//   페르소나 검사는 보통 서버와 연동(host) 서버를 같은 파일로 나란히 띄운다.
//   그런데 서버가 뜨면서 하는 일 셋이 전부 '보고 나서 고치는' 모양이라,
//   두 대가 같이 뜨면 둘 다 '아직 안 됐네' 를 보고 둘 다 하려 들었다.
//
//     journal_mode = WAL   파일을 잠깐 독차지해야 한다 → database is locked
//     ALTER TABLE 로 컬럼 넣기                          → duplicate column name
//     데모 데이터 넣기                                   → UNIQUE constraint failed: users.nickname
//
//   셋 다 서버가 아예 못 뜨는 오류라, 페르소나 검사 세 개(P8·P9·P10)가 통째로 못 돌고 있었다.
//   운영에서도 재시작이 겹치거나 실수로 두 번 띄우면 같은 일이 난다.
//
// 왜 프로세스를 진짜로 띄우나
//   한 프로세스 안에서는 src/db.js 가 한 번만 읽혀서 이 상황이 안 만들어진다.
//   겹치는 순간 자체가 봐야 할 것이라 실제로 두 대를 띄운다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT_A = 3471;
const PORT_B = 3472;

function start(dbPath, port, extra = {}) {
  const p = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, NODE_ENV: 'test', ...extra },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  p.err = '';
  p.stderr.on('data', (d) => { p.err += d; });
  return p;
}
async function up(port) {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/board`)).ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// 겹치는 순간에만 나는 문제라, 한 번 띄워 보고 멀쩡하다고 할 수 없다.
// 고친 것을 도로 빼고 재 보니 세 번 중 한 번만 걸렸다. 그래서 여러 번 띄운다.
// (세 번 다 빼고 재서, ROUNDS 회면 매번 걸리는 것을 확인했다.)
const ROUNDS = 4;

async function 한판(dbPath) {
  const a = start(dbPath, PORT_A);
  const b = start(dbPath, PORT_B, {
    AUTH_MODE: 'host', HOST_SSO_SECRET: 'x'.repeat(32), HOST_SSO_TTL_SEC: '300',
  });
  try {
    const [okA, okB] = await Promise.all([up(PORT_A), up(PORT_B)]);
    const known = (a.err + b.err)
      .match(/database is locked|duplicate column name|UNIQUE constraint failed: \S+/);
    return { okA, okB, known: known && known[0] };
  } finally {
    a.kill(); b.kill();
    await new Promise((r) => setTimeout(r, 250));
  }
}

// 위의 '두 대 띄우기' 로는 WAL 문제가 잘 안 잡힌다.
// 먼저 뜬 쪽이 WAL 로 바꿔 놓으면 나중 쪽은 '이미 WAL' 이라 부딪힐 일이 없어서,
// 아주 짧은 순간에 겹쳐야만 난다. 실제로 고친 것을 빼고 재도 두 번 다 안 걸렸다.
// 그래서 이건 겹치는 상황을 일부러 만들어 놓고 본다 — 쓰기 자물쇠를 잡은 채 서버 쪽을 띄운다.
test('남이 DB 를 쓰는 중에 떠도 죽지 않는다 (WAL 로 바꾸는 자리)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boardtest-wal-'));
  const dbPath = path.join(dir, 'busy.db');
  const Database = require('better-sqlite3');

  // WAL 이 아닌 상태로 만들어 둔다. 이미 WAL 이면 바꿀 일이 없어 상황이 안 만들어진다.
  const holder = new Database(dbPath);
  holder.pragma('journal_mode = delete');
  holder.exec('CREATE TABLE IF NOT EXISTS 자리 (id INTEGER PRIMARY KEY)');
  holder.exec('BEGIN IMMEDIATE');                 // 쓰기 자물쇠를 잡고 안 놓는다
  holder.prepare('INSERT INTO 자리 (id) VALUES (1)').run();

  const child = spawn(process.execPath,
    ['-e', "require('./src/db'); console.log('떴음');"],
    { cwd: ROOT, env: { ...process.env, DB_PATH: dbPath, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });

  // 400ms 쥐고 있다가 놓는다. 기다릴 줄 알면 살고, 곧바로 포기하면 죽는다.
  await new Promise((r) => setTimeout(r, 400));
  holder.exec('COMMIT');
  holder.close();

  const code = await new Promise((r) => child.on('exit', r));
  try {
    assert.ok(!/database is locked/i.test(err),
      'DB 가 잠겨 있다고 그냥 죽었어요 — 기다렸다 다시 해야 합니다');
    assert.strictEqual(code, 0, `서버 쪽이 죽었어요: ${err.split('\n').slice(0, 3).join(' | ')}`);
    assert.match(out, /떴음/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('빈 DB 하나에 서버 두 대가 같이 떠도 둘 다 산다', async () => {
  for (let i = 1; i <= ROUNDS; i++) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boardtest-race-'));
    const dbPath = path.join(dir, 'race.db');
    try {
      const r = await 한판(dbPath);
      assert.ok(!r.known, `${i}번째 판 — 서버가 뜨다가 죽었어요: ${r.known}`);
      assert.ok(r.okA, `${i}번째 판 — 보통 서버가 안 떴어요`);
      assert.ok(r.okB, `${i}번째 판 — 연동(host) 서버가 안 떴어요`);

      // 데모 데이터가 두 번 들어가지도 않아야 한다
      const db = require('better-sqlite3')(dbPath, { readonly: true });
      const n = db.prepare('SELECT COUNT(*) c FROM users').get().c;
      const dup = db.prepare(
        'SELECT nickname FROM users GROUP BY nickname HAVING COUNT(*) > 1').all();
      db.close();
      assert.ok(n > 0, `${i}번째 판 — 데모 데이터가 아무도 안 들어갔어요`);
      assert.deepStrictEqual(dup, [], `${i}번째 판 — 같은 닉네임이 두 번 들어갔어요`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});
