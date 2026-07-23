// HTTP 통합 테스트: 실제 서버를 띄워 라우트·권한·멱등성·보안을 검증
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 임시 DB로 격리 (앱 로드 전에 지정해야 함)
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'boardtest-int-')), 'test.db');
process.env.NODE_ENV = 'test';

const app = require('../server');
const db = require('../src/db');

let base;
let server;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
});
test.after(() => server && server.close());

// 아주 작은 쿠키 저장소
function makeJar() {
  let cookie = '';
  return {
    header: () => (cookie ? { Cookie: cookie } : {}),
    capture: (res) => {
      const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of sc) { const m = c.match(/^connect\.sid=[^;]+/); if (m) cookie = m[0]; }
    },
  };
}

function form(obj) {
  return new URLSearchParams(obj).toString();
}

async function post(pathname, body, jar) {
  const res = await fetch(base + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(jar ? jar.header() : {}) },
    body: form(body),
    redirect: 'manual',
  });
  if (jar) jar.capture(res);
  return res;
}
async function get(pathname, jar) {
  const res = await fetch(base + pathname, { headers: jar ? jar.header() : {}, redirect: 'manual' });
  if (jar) jar.capture(res);
  return res;
}

async function signup(jar, username, nickname, password = 'password123') {
  return post('/signup', { username, nickname, password }, jar);
}

test('보안 헤더가 응답에 포함된다', async () => {
  const res = await get('/board');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('회원가입 시 1,000P 지급 후 게시판으로 이동한다', async () => {
  const jar = makeJar();
  const res = await signup(jar, 'inttester', '통합테스터');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/board');
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get('inttester');
  assert.ok(u);
  assert.equal(u.points, 1000);
});

test('중복 아이디로는 가입할 수 없다', async () => {
  const jar = makeJar();
  const res = await signup(jar, 'inttester', '다른닉네임');
  assert.equal(res.status, 200); // 폼을 에러와 함께 다시 렌더
  const body = await res.text();
  assert.match(body, /이미 사용 중인 아이디/);
});

test('로그인 필요한 글쓰기는 비로그인 시 로그인으로 리다이렉트된다', async () => {
  const res = await get('/board/new');
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /^\/login/);
});

test('게시글을 작성하면 목록에 보이고 작성자 포인트가 오른다', async () => {
  const jar = makeJar();
  await signup(jar, 'writer1', '작성왕');
  const before = db.prepare("SELECT points FROM users WHERE username='writer1'").get().points;
  const res = await post('/board', { category: '질문', title: '통합 테스트 글', content: '본문 내용입니다.' }, jar);
  assert.equal(res.status, 302);
  const row = db.prepare("SELECT * FROM posts WHERE title = '통합 테스트 글'").get();
  assert.ok(row);
  assert.equal(row.category, '질문');
  const after = db.prepare("SELECT points FROM users WHERE username='writer1'").get().points;
  assert.equal(after - before, 300); // 일반 게시글 300P
});

test('잘못된 카테고리는 자유로 저장된다', async () => {
  const jar = makeJar();
  await signup(jar, 'writer2', '작성이');
  await post('/board', { category: '해킹카테고리', title: '카테고리 검증', content: '내용' }, jar);
  const row = db.prepare("SELECT category FROM posts WHERE title='카테고리 검증'").get();
  assert.equal(row.category, '자유');
});

test('내 글은 추천할 수 없고, 남의 글 추천은 1회만 반영된다(멱등)', async () => {
  const author = makeJar();
  await signup(author, 'author9', '글쓴이');
  await post('/board', { category: '자유', title: '추천 대상 글', content: '내용' }, author);
  const postId = db.prepare("SELECT id FROM posts WHERE title='추천 대상 글'").get().id;

  // 작성자가 자기 글 추천 시도 → 반영 안 됨
  await post(`/board/${postId}/like`, {}, author);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM likes WHERE post_id=?').get(postId).c, 0);

  // 다른 사용자가 추천 → 1
  const liker = makeJar();
  await signup(liker, 'liker9', '추천이');
  await post(`/board/${postId}/like`, {}, liker);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM likes WHERE post_id=?').get(postId).c, 1);

  // 같은 사용자가 다시 추천 → 여전히 1 (중복 차단)
  await post(`/board/${postId}/like`, {}, liker);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM likes WHERE post_id=?').get(postId).c, 1);
});

test('다른 사람의 글은 삭제할 수 없다', async () => {
  const owner = makeJar();
  await signup(owner, 'owner9', '주인');
  await post('/board', { category: '자유', title: '내 소중한 글', content: '지우지마' }, owner);
  const postId = db.prepare("SELECT id FROM posts WHERE title='내 소중한 글'").get().id;

  const attacker = makeJar();
  await signup(attacker, 'attacker9', '침입자');
  await post(`/board/${postId}/delete`, {}, attacker);

  const still = db.prepare('SELECT COUNT(*) c FROM posts WHERE id=?').get(postId).c;
  assert.equal(still, 1); // 삭제되지 않음
});

test('게시글 본문의 HTML은 이스케이프되어 저장·출력된다(XSS 방지)', async () => {
  const jar = makeJar();
  await signup(jar, 'xss9', '엑스');
  await post('/board', { category: '자유', title: '스크립트<b>테스트', content: '<script>alert(1)</script>' }, jar);
  const row = db.prepare("SELECT id FROM posts WHERE content = '<script>alert(1)</script>'").get();
  assert.ok(row); // 원문은 그대로 저장
  const res = await get(`/board/${row.id}`, jar);
  const body = await res.text();
  assert.ok(!body.includes('<script>alert(1)</script>')); // 실행 가능한 형태로 출력되지 않음
  assert.ok(body.includes('&lt;script&gt;'));             // 이스케이프되어 출력
});
