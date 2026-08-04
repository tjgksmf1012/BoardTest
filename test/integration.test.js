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

function makeJar() {
  let cookie = '';
  return {
    token: null,
    header: () => (cookie ? { Cookie: cookie } : {}),
    capture(res) {
      const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of sc) {
        const m = c.match(/^connect\.sid=[^;]+/);
        // 세션이 바뀌면(로그인·가입) CSRF 토큰도 새로 발급되므로 캐시를 버린다
        if (m && m[0] !== cookie) { cookie = m[0]; this.token = null; }
      }
    },
  };
}

// CSRF 토큰은 화면에서 받아온다 (실제 사용자가 폼을 열어보는 것과 같은 흐름)
async function csrfToken(jar) {
  if (jar && jar.token) return jar.token;
  const res = await fetch(base + '/board', { headers: jar ? jar.header() : {}, redirect: 'manual' });
  if (jar) jar.capture(res);
  const html = await res.text();
  const m = html.match(/name="csrf-token" content="([^"]+)"/);
  const t = m ? m[1] : '';
  if (jar) jar.token = t;
  return t;
}

function form(obj) {
  return new URLSearchParams(obj).toString();
}

async function post(pathname, body, jar) {
  // jar를 안 넘기면 세션이 이어지지 않아 CSRF 토큰이 어긋난다 — 일회용 jar로 대신한다
  if (!jar) jar = makeJar();
  const _csrf = await csrfToken(jar);
  const res = await fetch(base + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(jar ? jar.header() : {}) },
    body: form({ _csrf, ...body }),
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

// ---- 목록으로 돌아가기 ---------------------------------------------------------
// 3페이지에서 글을 열었다가 '목록'을 누르면 늘 첫 페이지로 튕겨서,
// 보던 자리까지 다시 내려가야 했다. 목록 상태를 링크에 실어 되돌린다.

test('글이 한 페이지를 넘으면 맨 아래에 페이지 번호가 나온다', async () => {
  const total = db.prepare('SELECT COUNT(*) c FROM posts WHERE is_notice = 0').get().c;
  assert.ok(total > 10, `한 페이지(10개)보다 많아야 번호가 나온다 — 지금 ${total}개`);
  const html = await (await get('/board')).text();
  assert.ok(html.includes('class="pager"'), '페이지 이동 줄이 있어야 한다');
  assert.match(html, /href="\/board\?page=2[^"]*"/, '2페이지로 가는 링크');
});

test('목록에서 연 글에는 보던 목록 상태가 함께 붙는다', async () => {
  const html = await (await get('/board?page=2&sort=likes')).text();
  // &는 화면에 &amp; 로 나온다 (HTML 규칙)
  assert.match(html, /href="\/board\/\d+\?page=2&amp;sort=likes"/, '글 링크가 목록 상태를 달고 있다');
});

test("글 화면의 '목록'은 보던 페이지·정렬·말머리로 돌아간다", async () => {
  const id = db.prepare('SELECT id FROM posts WHERE is_notice = 0 ORDER BY id LIMIT 1').get().id;
  const html = await (await get(`/board/${id}?page=2&sort=likes&category=%EC%A7%88%EB%AC%B8`)).text();
  const m = html.match(/href="([^"]*)"[^>]*>목록</);
  assert.ok(m, "'목록' 버튼을 찾지 못했다");
  const back = m[1].replace(/&amp;/g, '&');
  assert.ok(back.startsWith('/board?'), back);
  assert.ok(back.includes('page=2') && back.includes('sort=likes') && back.includes('category=%EC%A7%88%EB%AC%B8'), back);
});

test('목록 상태 없이 글을 열면 목록 버튼은 그냥 /board 다', async () => {
  const id = db.prepare('SELECT id FROM posts WHERE is_notice = 0 ORDER BY id LIMIT 1').get().id;
  const html = await (await get(`/board/${id}`)).text();
  assert.match(html, /href="\/board"[^>]*>목록</);
});

test('목록 상태는 아무 값이나 받지 않는다 (이상한 값은 버린다)', async () => {
  const id = db.prepare('SELECT id FROM posts WHERE is_notice = 0 ORDER BY id LIMIT 1').get().id;
  const html = await (await get(`/board/${id}?page=-3&sort=%22onx&category=없는말머리`)).text();
  const m = html.match(/href="([^"]*)"[^>]*>목록</);
  assert.equal(m[1], '/board', '걸러지고 나면 남는 게 없다');
});

// ---- 포인트 부호 ---------------------------------------------------------------
// 화면에서 '+' 를 먼저 붙이고 그 뒤에 금액을 찍고 있어서, 캐릭터를 사면
// "+-20,000P" 처럼 부호가 두 개 나왔다.

test('포인트가 빠져나간 내역은 − 하나로만 표시된다', async () => {
  const jar = makeJar();
  await signup(jar, 'sign9', '부호');
  const uid = db.prepare('SELECT id FROM users WHERE username = ?').get('sign9').id;
  db.prepare("INSERT INTO point_logs (user_id, amount, reason, detail) VALUES (?, -2000, 'purchase', '글램 골드 구매')").run(uid);

  const html = await (await get('/points', jar)).text();
  assert.ok(!html.includes('+-'), '부호가 두 개 붙어 있다');
  assert.ok(html.includes('−2,000P'), '빼기 기호로 한 번만 붙어야 한다');
});

test('포인트가 들어온 내역은 + 로 표시된다', async () => {
  const jar = makeJar();
  await signup(jar, 'sign10', '부호둘');
  const html = await (await get('/points', jar)).text();
  assert.ok(html.includes('+1,000P'), '가입 1,000P 가 + 로 보여야 한다');
});

test("'오늘 적립'은 오늘 번 것만 센다 (구매로 쓴 돈에 깎이지 않는다)", async () => {
  const jar = makeJar();
  await signup(jar, 'today9', '오늘');
  const uid = db.prepare('SELECT id FROM users WHERE username = ?').get('today9').id;
  // 가입 1,000P 를 받은 당일에 2,000P 짜리 캐릭터를 샀다고 치면
  db.prepare("INSERT INTO point_logs (user_id, amount, reason, detail) VALUES (?, -2000, 'purchase', '캐릭터 구매')").run(uid);

  const html = await (await get('/points', jar)).text();
  const m = html.match(/오늘 적립[\s\S]{0,120}?>([−+][\d,]+P)</);
  assert.ok(m, "'오늘 적립' 값을 찾지 못했다");
  assert.equal(m[1], '+1,000P', `적립만 세야 하는데 ${m[1]} 이 나왔다`);
});
