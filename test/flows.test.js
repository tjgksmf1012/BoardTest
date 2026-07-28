// HTTP 상호작용 흐름 테스트: 출석·댓글·알림·스크랩·댓글좋아요·운영자추천·검색
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'boardtest-flow-')), 'test.db');
process.env.NODE_ENV = 'test';

const app = require('../server');
const db = require('../src/db');

let base, server;
test.before(async () => {
  await new Promise((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
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

const form = (o) => new URLSearchParams(o).toString();
async function post(p, body, jar) {
  // jar를 안 넘기면 세션이 이어지지 않아 CSRF 토큰이 어긋난다 — 일회용 jar로 대신한다
  if (!jar) jar = makeJar();
  const _csrf = await csrfToken(jar);
  const res = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(jar ? jar.header() : {}) }, body: form({ _csrf, ...body }), redirect: 'manual' });
  if (jar) jar.capture(res); return res;
}
async function get(p, jar) {
  const res = await fetch(base + p, { headers: jar ? jar.header() : {}, redirect: 'manual' });
  if (jar) jar.capture(res); return res;
}
async function signup(jar, u, n) { return post('/signup', { username: u, nickname: n, password: 'password123' }, jar); }
async function login(jar, u, p) { return post('/login', { username: u, password: p }, jar); }
async function newPost(jar, title, extra = {}) {
  await post('/board', { category: '자유', title, content: '본문', ...extra }, jar);
  return db.prepare('SELECT * FROM posts WHERE title = ?').get(title);
}
const uid = (username) => db.prepare('SELECT id FROM users WHERE username = ?').get(username).id;

test('출석체크는 첫 회 +100P, 같은 날 재출석은 차단된다', async () => {
  const jar = makeJar();
  await signup(jar, 'att1', '출석이');
  const before = db.prepare("SELECT points FROM users WHERE username='att1'").get().points;
  await post('/attendance/check', {}, jar);
  const mid = db.prepare("SELECT points FROM users WHERE username='att1'").get().points;
  assert.equal(mid - before, 100);
  await post('/attendance/check', {}, jar); // 재출석
  const after = db.prepare("SELECT points FROM users WHERE username='att1'").get().points;
  assert.equal(after, mid); // 변화 없음
});

test('출석 팝업은 출석 전에만 뜨고, 출석하면 그날은 뜨지 않는다', async () => {
  const jar = makeJar();
  await signup(jar, 'attpop', '팝업이');
  // 출석 전: 어느 화면에서든 팝업이 나온다
  const before = await (await get('/board', jar)).text();
  assert.ok(before.includes('id="attPop"'), '출석 전에는 팝업이 있어야 한다');
  await post('/attendance/check', {}, jar);
  // 출석 후: 서버가 판단하므로 브라우저 저장소와 무관하게 사라진다
  const after = await (await get('/board', jar)).text();
  assert.ok(!after.includes('id="attPop"'), '출석 후에는 팝업이 없어야 한다');
});

test('출석부는 JSON으로 도장판·연속일수·다음 보너스를 함께 돌려준다', async () => {
  const jar = makeJar();
  await signup(jar, 'attjson', '출석부');
  const res = await fetch(base + '/attendance/check', {
    method: 'POST',
    headers: { Accept: 'application/json', 'X-CSRF-Token': await csrfToken(jar), ...jar.header() },
    redirect: 'manual',
  });
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.already, false);
  assert.equal(d.awarded, 100);
  assert.equal(d.streak, 1);
  assert.equal(d.week.length, 7, '최근 7일 도장판');
  assert.equal(d.week[6].today, true, '마지막 칸이 오늘');
  assert.equal(d.week[6].checked, true, '오늘 칸에 도장이 찍혀 있어야 한다');
  assert.deepEqual({ days: d.next.days, remain: d.next.remain }, { days: 3, remain: 2 });
  assert.equal(typeof d.points, 'number');
});

test('같은 날 두 번 요청해도 포인트는 한 번만 지급된다', async () => {
  const jar = makeJar();
  await signup(jar, 'attdup', '중복이');
  const call = async () => (await fetch(base + '/attendance/check', {
    method: 'POST',
    headers: { Accept: 'application/json', 'X-CSRF-Token': await csrfToken(jar), ...jar.header() },
    redirect: 'manual',
  })).json();
  const first = await call();
  const second = await call();
  assert.equal(first.awarded, 100);
  assert.equal(second.already, true);
  assert.equal(second.awarded, 0, '두 번째는 지급되지 않아야 한다');
  assert.equal(second.streak, 1, '이미 출석해도 연속일수는 그대로 알려준다');
  const logs = db.prepare(
    "SELECT COUNT(*) c FROM point_logs WHERE user_id = ? AND reason = 'attendance'"
  ).get(uid('attdup')).c;
  assert.equal(logs, 1);
});

test('3일 연속이면 보너스가 함께 지급된다', async () => {
  const jar = makeJar();
  await signup(jar, 'attmile', '연속이');
  const id = uid('attmile');
  const p = (n) => String(n).padStart(2, '0');
  const dayAgo = (o) => { const d = new Date(); d.setDate(d.getDate() - o);
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  [1, 2].forEach((o) => db.prepare('INSERT INTO attendance (user_id, day) VALUES (?, ?)').run(id, dayAgo(o)));

  const d = await (await fetch(base + '/attendance/check', {
    method: 'POST',
    headers: { Accept: 'application/json', 'X-CSRF-Token': await csrfToken(jar), ...jar.header() },
    redirect: 'manual',
  })).json();
  assert.equal(d.streak, 3);
  assert.equal(d.base, 100);
  assert.equal(d.bonus, 500, '3일 연속 보너스');
  assert.equal(d.awarded, 600);
  assert.equal(d.next.days, 7, '다음 목표는 7일');
});

test('비로그인 상태에는 출석 팝업이 뜨지 않는다', async () => {
  const html = await (await get('/board')).text();
  assert.ok(!html.includes('id="attPop"'));
});

test('출석 후에는 폼에 담긴 원래 화면으로 돌아간다', async () => {
  const jar = makeJar();
  await signup(jar, 'attback', '복귀자');
  const res = await post('/attendance/check', { next: '/ranking' }, jar);
  assert.equal(res.headers.get('location'), '/ranking');
});

test('출석 복귀 주소로 외부 주소를 넣어도 따라가지 않는다', async () => {
  const jar = makeJar();
  await signup(jar, 'attevil', '침입자');
  for (const bad of ['https://evil.example.com', '//evil.example.com', 'javascript:alert(1)']) {
    const res = await post('/attendance/check', { next: bad }, jar);
    assert.equal(res.headers.get('location'), '/profile#attendance', `막아야 함: ${bad}`);
  }
});

test('옛 출석 주소는 마이페이지 출석 탭으로 넘어간다', async () => {
  const jar = makeJar();
  await signup(jar, 'attold', '옛주소');
  const res = await get('/attendance', jar);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/profile#attendance');
});

test('출석 기록은 마이페이지 출석 탭에서 확인된다', async () => {
  const jar = makeJar();
  await signup(jar, 'attcal', '달력이');
  await post('/attendance/check', {}, jar);
  const html = await (await get('/profile', jar)).text();
  assert.ok(html.includes('panel-attendance'), '출석 탭 패널이 있어야 한다');
  assert.ok(html.includes('연속 출석 현황'));
  assert.ok(html.includes('오늘 출석 완료'), '출석했으면 완료 상태로 보여야 한다');
});

test('서식 있는 글은 정화되어 저장되고 본문에 그대로 출력된다', async () => {
  const jar = makeJar();
  await signup(jar, 'rich1', '서식이');
  await post('/board', {
    category: '자유', title: '서식 글',
    content_format: 'html',
    content: '<h2>소제목</h2><p><strong>굵게</strong></p><script>alert(1)</script>',
  }, jar);
  const p = db.prepare("SELECT * FROM posts WHERE title = '서식 글'").get();
  assert.equal(p.content_format, 'html');
  assert.ok(!p.content.includes('<script'), '스크립트는 저장되면 안 된다');
  assert.ok(p.content.includes('<h2>소제목</h2>'));
  assert.equal(p.content_text, '소제목 굵게', '평문 사본이 함께 저장돼야 한다');

  const html = await (await get(`/board/${p.id}`, jar)).text();
  assert.ok(html.includes('<h2>소제목</h2>'), '서식이 살아서 출력돼야 한다');
  assert.ok(!html.includes('alert(1)'));
});

test('옛 평문 글은 예전처럼 이스케이프되어 안전하게 나온다', async () => {
  const jar = makeJar();
  await signup(jar, 'plain1', '평문이');
  await post('/board', { category: '자유', title: '평문 글', content: '<b>태그처럼 보이는 글</b>' }, jar);
  const p = db.prepare("SELECT * FROM posts WHERE title = '평문 글'").get();
  assert.equal(p.content_format, 'text');
  const html = await (await get(`/board/${p.id}`, jar)).text();
  assert.ok(html.includes('&lt;b&gt;'), '평문 글의 꺾쇠는 이스케이프돼야 한다');
});

test('검색은 HTML 태그 이름에 걸리지 않는다', async () => {
  const jar = makeJar();
  await signup(jar, 'srch1', '검색이');
  await post('/board', {
    category: '자유', title: '검색 대상 글', content_format: 'html',
    content: '<blockquote>인용한 문장</blockquote>',
  }, jar);
  const byTag = await (await get('/board?q=blockquote', jar)).text();
  assert.ok(!byTag.includes('검색 대상 글'), '태그 이름으로는 검색되면 안 된다');
  const byWord = await (await get('/board?q=' + encodeURIComponent('인용한'), jar)).text();
  assert.ok(byWord.includes('검색 대상 글'), '본문 낱말로는 검색돼야 한다');
});

test('본문에서 지운 사진은 첨부 기록에서도 정리된다', async () => {
  const jar = makeJar();
  await signup(jar, 'imgs1', '사진이');
  await post('/board', {
    category: '자유', title: '사진 글', content_format: 'html',
    content: '<p><img src="/uploads/a.png"></p><p><img src="/uploads/b.png"></p>',
  }, jar);
  const p = db.prepare("SELECT * FROM posts WHERE title = '사진 글'").get();
  assert.equal(db.prepare('SELECT COUNT(*) c FROM post_images WHERE post_id = ?').get(p.id).c, 2);

  // 한 장만 남기고 수정
  await post(`/board/${p.id}/edit`, {
    category: '자유', title: '사진 글', content_format: 'html',
    content: '<p><img src="/uploads/a.png"></p>',
  }, jar);
  const rows = db.prepare('SELECT filename FROM post_images WHERE post_id = ?').all(p.id);
  assert.deepEqual(rows.map((r) => r.filename), ['a.png']);
});

test('사진은 5장까지만 넣을 수 있다', async () => {
  const jar = makeJar();
  await signup(jar, 'imgmax', '장수제한');
  const six = Array.from({ length: 6 }, (_, i) => `<p><img src="/uploads/x${i}.png"></p>`).join('');
  await post('/board', {
    category: '자유', title: '사진 6장 글', content_format: 'html', content: six,
  }, jar);
  assert.ok(!db.prepare("SELECT 1 FROM posts WHERE title = '사진 6장 글'").get(), '6장은 등록되면 안 된다');

  const five = Array.from({ length: 5 }, (_, i) => `<p><img src="/uploads/y${i}.png"></p>`).join('');
  await post('/board', {
    category: '자유', title: '사진 5장 글', content_format: 'html', content: five,
  }, jar);
  assert.ok(db.prepare("SELECT 1 FROM posts WHERE title = '사진 5장 글'").get(), '5장은 등록돼야 한다');
});

test('검색어의 % _ 는 와일드카드가 아니라 글자로 취급된다', async () => {
  const jar = makeJar();
  await signup(jar, 'srch2', '와일드');
  await newPost(jar, '할인 50% 행사');
  await newPost(jar, '와일드카드 없는 글');

  // '%' 하나로 전체 글이 쏟아지면 안 된다
  const all = await (await get('/board?q=' + encodeURIComponent('%'), jar)).text();
  assert.ok(!all.includes('와일드카드 없는 글'), "'%'가 전체 검색이 되면 안 된다");
  // 진짜 % 가 들어간 제목은 찾아진다
  assert.ok(all.includes('할인 50% 행사'), '글자로서의 %는 검색돼야 한다');
});

test('로그인하면 세션 ID가 새로 발급된다 (세션 고정 방어)', async () => {
  const jar = makeJar();
  await get('/board', jar);          // 익명 세션 하나 받아두고
  const before = jar.header().Cookie;
  await signup(jar, 'sessfix', '세션이');
  const after = jar.header().Cookie;
  if (before) assert.notEqual(before, after, '로그인 후 세션 쿠키가 바뀌어야 한다');
  assert.ok(after, '로그인 세션 쿠키가 있어야 한다');
});

test('사진이 있으면 글자가 없어도 등록된다', async () => {
  const jar = makeJar();
  await signup(jar, 'imgonly', '사진만');
  await post('/board', {
    category: '자유', title: '사진만 있는 글', content_format: 'html',
    content: '<p><img src="/uploads/only.png"></p>',
  }, jar);
  assert.ok(db.prepare("SELECT 1 FROM posts WHERE title = '사진만 있는 글'").get());
});

test('사진 업로드는 로그인해야 쓸 수 있다', async () => {
  const guest = makeJar();               // 로그인만 안 한 평범한 방문자
  const res = await post('/board/upload-image', {}, guest);
  assert.equal(res.status, 302);
  assert.ok((res.headers.get('location') || '').startsWith('/login'));
});

test('댓글을 달면 +100P가 지급되고 글 작성자에게 알림이 생성된다', async () => {
  const author = makeJar(); await signup(author, 'cauth', '글쓴이');
  const p = await newPost(author, '댓글 받을 글');
  const commenter = makeJar(); await signup(commenter, 'cmt1', '댓글러');
  const before = db.prepare("SELECT points FROM users WHERE username='cmt1'").get().points;
  await post(`/board/${p.id}/comments`, { content: '좋은 글이네요' }, commenter);
  const after = db.prepare("SELECT points FROM users WHERE username='cmt1'").get().points;
  assert.equal(after - before, 100);
  const notiCount = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ?').get(uid('cauth')).c;
  assert.ok(notiCount >= 1);
});

test('댓글 차단된 글에는 댓글이 달리지 않는다', async () => {
  const jar = makeJar(); await signup(jar, 'blk1', '차단자');
  const p = await newPost(jar, '댓글 차단 글', { block_comments: '1' });
  const other = makeJar(); await signup(other, 'blk2', '시도자');
  await post(`/board/${p.id}/comments`, { content: '댓글 시도' }, other);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM comments WHERE post_id = ?').get(p.id).c, 0);
});

test('스크랩은 토글된다(추가 후 다시 누르면 해제)', async () => {
  const author = makeJar(); await signup(author, 'bmauth', '글쓴이2');
  const p = await newPost(author, '스크랩 대상');
  const me = makeJar(); await signup(me, 'bmme', '북마커');
  await post(`/board/${p.id}/bookmark`, {}, me);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM bookmarks WHERE post_id=? AND user_id=?').get(p.id, uid('bmme')).c, 1);
  await post(`/board/${p.id}/bookmark`, {}, me);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM bookmarks WHERE post_id=? AND user_id=?').get(p.id, uid('bmme')).c, 0);
});

test('댓글 좋아요는 멱등이고, 내 댓글엔 좋아요할 수 없다', async () => {
  const author = makeJar(); await signup(author, 'clauth', '댓글주인');
  const p = await newPost(author, '댓글 좋아요 글');
  await post(`/board/${p.id}/comments`, { content: '내 댓글' }, author);
  const cid = db.prepare('SELECT id FROM comments WHERE post_id=? ORDER BY id DESC LIMIT 1').get(p.id).id;
  // 내 댓글 좋아요 차단
  await post(`/board/comments/${cid}/like`, {}, author);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM comment_likes WHERE comment_id=?').get(cid).c, 0);
  // 다른 사람이 좋아요 → 1, 다시 누르면 토글 해제 → 0
  const other = makeJar(); await signup(other, 'cluser', '좋아요러');
  await post(`/board/comments/${cid}/like`, {}, other);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM comment_likes WHERE comment_id=?').get(cid).c, 1);
  await post(`/board/comments/${cid}/like`, {}, other);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM comment_likes WHERE comment_id=?').get(cid).c, 0);
});

test('운영자만 추천글로 선정할 수 있고 작성자에게 +1,500P가 지급된다', async () => {
  const author = makeJar(); await signup(author, 'pickauth', '피추천');
  const p = await newPost(author, '운영자 추천 대상');
  const before = db.prepare('SELECT points FROM users WHERE id=?').get(uid('pickauth')).points;

  // 일반 사용자는 불가
  const normal = makeJar(); await signup(normal, 'normaluser', '일반이');
  await post(`/board/${p.id}/admin-pick`, {}, normal);
  assert.equal(db.prepare('SELECT admin_picked FROM posts WHERE id=?').get(p.id).admin_picked, 0);

  // 운영자는 가능 (+1,500P)
  const admin = makeJar(); await login(admin, 'admin', 'admin1234');
  await post(`/board/${p.id}/admin-pick`, {}, admin);
  assert.equal(db.prepare('SELECT admin_picked FROM posts WHERE id=?').get(p.id).admin_picked, 1);
  const after = db.prepare('SELECT points FROM users WHERE id=?').get(uid('pickauth')).points;
  assert.equal(after - before, 1500);
});

test('검색 결과가 없으면 전용 안내 문구가 나온다', async () => {
  const res = await get('/board?q=' + encodeURIComponent('절대없을검색어zzz999'));
  const body = await res.text();
  assert.match(body, /검색 결과가 없어요/);
});

test('로그인 실패가 반복되면 일시적으로 차단된다(무차별 대입 방어)', async () => {
  await signup(makeJar(), 'brute', '표적'); // 대상 계정 존재
  // 다른 테스트의 로그인에 영향을 주지 않도록 가짜 IP로 격리해서 실패 반복
  const attacker = makeJar();
  let blocked = false;
  for (let i = 0; i < 12; i++) {
    const res = await fetch(base + '/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Forwarded-For': '203.0.113.7',
        ...attacker.header(),
      },
      body: form({ _csrf: await csrfToken(attacker), username: 'brute', password: 'wrong' + i }),
      redirect: 'manual',
    });
    attacker.capture(res);
    if (/시도가 너무 많아요/.test(await res.text())) { blocked = true; break; }
  }
  assert.ok(blocked, '반복 실패 후 차단 메시지가 나와야 한다');
});

test('운영자는 글을 숨김 처리/해제할 수 있고, 숨김 글은 비운영자에게 404다', async () => {
  const author = makeJar(); await signup(author, 'hideauth', '숨김대상');
  const p = await newPost(author, '숨겨질 글');
  const admin = makeJar(); await login(admin, 'admin', 'admin1234');
  // 숨김
  await post(`/board/${p.id}/hide`, {}, admin);
  assert.equal(db.prepare('SELECT is_hidden FROM posts WHERE id=?').get(p.id).is_hidden, 1);
  // 비로그인 사용자는 404
  const guest = makeJar();
  assert.equal((await get(`/board/${p.id}`, guest)).status, 404);
  // 운영자는 열람 가능(200)
  assert.equal((await get(`/board/${p.id}`, admin)).status, 200);
  // 숨김 해제
  await post(`/board/${p.id}/hide`, {}, admin);
  assert.equal(db.prepare('SELECT is_hidden FROM posts WHERE id=?').get(p.id).is_hidden, 0);
  assert.equal((await get(`/board/${p.id}`, guest)).status, 200);
});

test('일반 사용자는 숨김 처리를 할 수 없다', async () => {
  const author = makeJar(); await signup(author, 'hideowner', '숨김주인');
  const p = await newPost(author, '보호될 글');
  const attacker = makeJar(); await signup(attacker, 'hideatk', '숨김침입');
  await post(`/board/${p.id}/hide`, {}, attacker);
  assert.equal(db.prepare('SELECT is_hidden FROM posts WHERE id=?').get(p.id).is_hidden, 0);
});

test('운영자는 회원을 제재/해제할 수 있고, 제재된 회원은 로그인할 수 없다', async () => {
  const victim = makeJar(); await signup(victim, 'banme', '피제재');
  const admin = makeJar(); await login(admin, 'admin', 'admin1234');
  await post(`/admin/members/${uid('banme')}/ban`, {}, admin);
  assert.equal(db.prepare("SELECT is_banned FROM users WHERE username='banme'").get().is_banned, 1);

  // 제재된 계정은 로그인 실패(에러 문구)
  const res = await post('/login', { username: 'banme', password: 'password123' });
  const body = await res.text();
  assert.match(body, /이용이 제한된 계정/);

  // 해제하면 다시 로그인 가능
  await post(`/admin/members/${uid('banme')}/ban`, {}, admin);
  const ok = await post('/login', { username: 'banme', password: 'password123' }, makeJar());
  assert.equal(ok.status, 302);
});

test('운영자 계정과 본인은 제재할 수 없다', async () => {
  const admin = makeJar(); await login(admin, 'admin', 'admin1234');
  await post(`/admin/members/${uid('admin')}/ban`, {}, admin); // 본인(운영자) 제재 시도
  assert.equal(db.prepare("SELECT is_banned FROM users WHERE username='admin'").get().is_banned, 0);
});

test('일반 사용자는 회원 관리 페이지에 접근할 수 없다', async () => {
  const jar = makeJar(); await signup(jar, 'nomember', '일반');
  const res = await get('/admin/members', jar);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/board');
});

test('댓글을 신고할 수 있고 중복 신고는 무시되며 내 댓글은 신고할 수 없다', async () => {
  const author = makeJar(); await signup(author, 'crauth', '댓글주인2');
  const p = await newPost(author, '댓글 신고 대상 글');
  await post(`/board/${p.id}/comments`, { content: '신고될 댓글' }, author);
  const cid = db.prepare('SELECT id FROM comments WHERE post_id=? ORDER BY id DESC LIMIT 1').get(p.id).id;

  // 작성자 본인은 신고 불가
  await post(`/board/comments/${cid}/report`, {}, author);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM comment_reports WHERE comment_id=?').get(cid).c, 0);

  // 다른 사용자 신고 → 1, 중복 신고 → 여전히 1
  const reporter = makeJar(); await signup(reporter, 'crrep', '신고자');
  await post(`/board/comments/${cid}/report`, {}, reporter);
  await post(`/board/comments/${cid}/report`, {}, reporter);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM comment_reports WHERE comment_id=?').get(cid).c, 1);
});

test('운영자는 신고된 댓글을 반려할 수 있고, 일반 사용자는 반려할 수 없다', async () => {
  const author = makeJar(); await signup(author, 'crd1', '댓글주인3');
  const p = await newPost(author, '댓글 반려 글');
  await post(`/board/${p.id}/comments`, { content: '반려 대상 댓글' }, author);
  const cid = db.prepare('SELECT id FROM comments WHERE post_id=? ORDER BY id DESC LIMIT 1').get(p.id).id;
  const reporter = makeJar(); await signup(reporter, 'crd2', '신고자2');
  await post(`/board/comments/${cid}/report`, {}, reporter);

  // 일반 사용자는 반려 불가
  await post(`/board/comments/${cid}/dismiss-reports`, {}, reporter);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM comment_reports WHERE comment_id=?').get(cid).c, 1);

  // 운영자는 반려 가능
  const admin = makeJar(); await login(admin, 'admin', 'admin1234');
  await post(`/board/comments/${cid}/dismiss-reports`, {}, admin);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM comment_reports WHERE comment_id=?').get(cid).c, 0);
});

test('알림 목록을 열면 안 읽은 알림이 읽음 처리된다', async () => {
  const author = makeJar(); await signup(author, 'ntauth', '알림주인');
  const p = await newPost(author, '알림 테스트 글');
  const actor = makeJar(); await signup(actor, 'ntactor', '반응이');
  await post(`/board/${p.id}/like`, {}, actor); // author에게 알림
  assert.ok(db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(uid('ntauth')).c >= 1);
  await get('/notifications', author); // 목록 열람
  assert.equal(db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(uid('ntauth')).c, 0);
});

test('본인 댓글만 수정할 수 있고, 수정하면 표시가 남는다', async () => {
  const owner = makeJar(); await signup(owner, 'cedit1', '댓글수정주');
  const other = makeJar(); await signup(other, 'cedit2', '남의사람');
  const p = await newPost(owner, '댓글 수정 대상 글');
  await post(`/board/${p.id}/comments`, { content: '처음 내용' }, owner);
  const c = db.prepare('SELECT * FROM comments WHERE post_id = ?').get(p.id);
  assert.equal(c.updated_at, null, '처음엔 수정 표시가 없어야 한다');

  // 남이 고치려 하면 막힌다
  await post(`/board/comments/${c.id}/edit`, { content: '남이 바꾼 내용' }, other);
  assert.equal(db.prepare('SELECT content FROM comments WHERE id = ?').get(c.id).content, '처음 내용');

  // 본인은 고칠 수 있고 수정 시각이 남는다
  await post(`/board/comments/${c.id}/edit`, { content: '고친 내용' }, owner);
  const after = db.prepare('SELECT * FROM comments WHERE id = ?').get(c.id);
  assert.equal(after.content, '고친 내용');
  assert.ok(after.updated_at, '수정 시각이 기록돼야 한다');

  const html = await (await get(`/board/${p.id}`, owner)).text();
  assert.ok(html.includes('수정됨'), '화면에 수정 표시가 보여야 한다');
});

test('빈 댓글이나 1,000자 초과로는 수정되지 않는다', async () => {
  const jar = makeJar(); await signup(jar, 'cedit3', '길이제한');
  const p = await newPost(jar, '길이 검사 글');
  await post(`/board/${p.id}/comments`, { content: '원래 내용' }, jar);
  const c = db.prepare('SELECT * FROM comments WHERE post_id = ?').get(p.id);
  for (const bad of ['', '   ', 'x'.repeat(1001)]) {
    await post(`/board/comments/${c.id}/edit`, { content: bad }, jar);
    assert.equal(db.prepare('SELECT content FROM comments WHERE id = ?').get(c.id).content, '원래 내용');
  }
});

test('답글이 많으면 앞 2개만 펼쳐두고 나머지는 접어 둔다', async () => {
  const jar = makeJar(); await signup(jar, 'creply', '답글러');
  const p = await newPost(jar, '답글 많은 글');
  await post(`/board/${p.id}/comments`, { content: '부모 댓글' }, jar);
  const parent = db.prepare('SELECT * FROM comments WHERE post_id = ?').get(p.id);
  for (let i = 1; i <= 5; i++) {
    await post(`/board/${p.id}/comments`, { content: `답글${i}`, parent_id: String(parent.id) }, jar);
  }
  const html = await (await get(`/board/${p.id}`, jar)).text();
  assert.ok(html.includes('답글 3개 더 보기'), '나머지 3개는 접혀 있어야 한다');
  assert.ok(html.includes('reply-rest'), '접힌 영역이 있어야 한다');
});

test('공개 프로필은 다른 사람의 활동을 보여주되 익명글은 감춘다', async () => {
  const author = makeJar(); await signup(author, 'pubp1', '공개프로필');
  const viewer = makeJar(); await signup(viewer, 'pubp2', '구경꾼');
  await newPost(author, '공개된 글이에요');
  await newPost(author, '익명으로 쓴 글', { is_anonymous: '1' });
  const id = uid('pubp1');

  const html = await (await get(`/users/${id}`, viewer)).text();
  assert.ok(html.includes('공개프로필'), '닉네임이 보여야 한다');
  assert.ok(html.includes('공개된 글이에요'), '공개 글은 보여야 한다');
  assert.ok(!html.includes('익명으로 쓴 글'), '익명글은 감춰야 한다');
  assert.ok(!html.includes('스크랩한 글'), '남의 스크랩은 보이면 안 된다');
  assert.ok(!html.includes('아바타 꾸미기'), '남의 아바타 설정은 보이면 안 된다');
});

test('내 공개 프로필 주소는 마이페이지로 넘어간다', async () => {
  const jar = makeJar(); await signup(jar, 'pubp3', '본인확인');
  const res = await get(`/users/${uid('pubp3')}`, jar);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/profile');
});

test('없는 회원의 프로필은 404', async () => {
  const res = await get('/users/999999');
  assert.equal(res.status, 404);
});

test('답글이 달린 댓글을 지워도 남의 답글은 남는다', async () => {
  const owner = makeJar(); await signup(owner, 'sdel1', '부모작성자');
  const other = makeJar(); await signup(other, 'sdel2', '답글작성자');
  const p = await newPost(owner, '삭제 연쇄 검사 글');
  await post(`/board/${p.id}/comments`, { content: '부모 댓글' }, owner);
  const parent = db.prepare('SELECT * FROM comments WHERE post_id = ?').get(p.id);
  for (const t of ['답글 하나', '답글 둘']) {
    await post(`/board/${p.id}/comments`, { content: t, parent_id: String(parent.id) }, other);
  }

  await post(`/board/comments/${parent.id}/delete`, {}, owner);
  const after = db.prepare('SELECT * FROM comments WHERE id = ?').get(parent.id);
  assert.ok(after, '부모 자리는 남아야 한다');
  assert.equal(after.is_deleted, 1);
  assert.equal(after.content, '', '내용은 지워져야 한다');
  assert.equal(
    db.prepare('SELECT COUNT(*) c FROM comments WHERE parent_id = ?').get(parent.id).c, 2,
    '남이 단 답글은 그대로 있어야 한다');

  const html = await (await get(`/board/${p.id}`, owner)).text();
  assert.ok(html.includes('삭제된 댓글이에요'));
  assert.ok(!html.includes('부모 댓글'), '지운 내용이 화면에 남으면 안 된다');
});

test('답글 없는 댓글은 흔적 없이 지워진다', async () => {
  const jar = makeJar(); await signup(jar, 'sdel3', '단독댓글');
  const p = await newPost(jar, '단독 댓글 글');
  await post(`/board/${p.id}/comments`, { content: '혼자 있는 댓글' }, jar);
  const c = db.prepare('SELECT * FROM comments WHERE post_id = ?').get(p.id);
  await post(`/board/comments/${c.id}/delete`, {}, jar);
  assert.ok(!db.prepare('SELECT 1 FROM comments WHERE id = ?').get(c.id));
});

test('삭제 흔적은 댓글 수에 세지 않는다', async () => {
  const owner = makeJar(); await signup(owner, 'sdel4', '집계주인');
  const other = makeJar(); await signup(other, 'sdel5', '집계답글');
  const p = await newPost(owner, '댓글 수 집계 글');
  await post(`/board/${p.id}/comments`, { content: '지울 부모' }, owner);
  const parent = db.prepare('SELECT * FROM comments WHERE post_id = ?').get(p.id);
  await post(`/board/${p.id}/comments`, { content: '남는 답글', parent_id: String(parent.id) }, other);
  await post(`/board/comments/${parent.id}/delete`, {}, owner);

  const row = db.prepare(
    'SELECT (SELECT COUNT(*) FROM comments c WHERE c.post_id = ? AND c.is_deleted = 0) AS n'
  ).get(p.id);
  assert.equal(row.n, 1, '살아 있는 댓글만 세야 한다');
});

test('페이지가 많아도 링크는 일부만 그린다', async () => {
  const jar = makeJar(); await signup(jar, 'pager1', '페이저');
  const u = uid('pager1');
  const ins = db.prepare("INSERT INTO posts (user_id, title, content, content_text) VALUES (?, ?, '본문', '본문')");
  db.transaction(() => { for (let i = 0; i < 300; i++) ins.run(u, `페이지용 글 ${i}`); })();

  const html = await (await get('/board')).text();
  const links = (html.match(/class="page/g) || []).length;
  assert.ok(links > 0 && links <= 12, `페이지 링크가 너무 많다: ${links}개`);
  assert.ok(html.includes('/ '), '현재 위치 표시가 있어야 한다');
});

test('말머리로 거른 상태에서 페이지를 넘겨도 필터가 유지된다', async () => {
  const html = await (await get('/board?category=' + encodeURIComponent('질문'))).text();
  const next = html.match(/href="\/board\?page=2[^"]*"/);
  if (next) assert.ok(next[0].includes('category='), '페이지 링크에 말머리가 남아야 한다');
});

test('글을 지우면 그 글을 가리키던 알림도 함께 사라진다', async () => {
  const author = makeJar(); await signup(author, 'noti1', '알림글주인');
  const other = makeJar(); await signup(other, 'noti2', '알림보낸이');
  const p = await newPost(author, '알림 정리 대상 글');
  await post(`/board/${p.id}/comments`, { content: '댓글이요' }, other);
  assert.equal(
    db.prepare('SELECT COUNT(*) c FROM notifications WHERE link = ?').get(`/board/${p.id}`).c, 1);

  await post(`/board/${p.id}/delete`, {}, author);
  assert.equal(
    db.prepare('SELECT COUNT(*) c FROM notifications WHERE link = ?').get(`/board/${p.id}`).c, 0,
    '없는 글을 가리키는 알림이 남으면 눌렀을 때 404가 된다');
});

test('링크를 공유하면 글 제목과 요약이 미리보기로 실린다', async () => {
  const jar = makeJar(); await signup(jar, 'ogtest', '공유하기');
  const p = await newPost(jar, '공유될 글 제목');
  const html = await (await get(`/board/${p.id}`, jar)).text();
  assert.ok(html.includes('property="og:title" content="공유될 글 제목"'));
  assert.ok(html.includes('property="og:type" content="article"'));
  assert.ok(html.includes('property="og:url"'));
});

test('익명글은 공유 미리보기에 본문이 실리지 않는다', async () => {
  const jar = makeJar(); await signup(jar, 'oganon', '익명공유');
  const p = await newPost(jar, '익명 공유 글', { is_anonymous: '1', content: '비밀스러운 본문 내용' });
  const html = await (await get(`/board/${p.id}`, jar)).text();
  assert.ok(!html.includes('content="비밀스러운 본문 내용'), '익명글 본문이 미리보기로 새면 안 된다');
  assert.ok(html.includes('포인트라운지의 게시글이에요'));
});

test('테스트끼리 아이디·닉네임이 겹치지 않는다 (겹치면 가입이 조용히 실패한다)', () => {
  const src = fs.readFileSync(__filename, 'utf8');
  const pairs = [...src.matchAll(/signup\(\w+,\s*'([^']+)',\s*'([^']+)'\)/g)];
  for (const [label, idx] of [['아이디', 1], ['닉네임', 2]]) {
    const seen = new Map();
    for (const m of pairs) {
      const v = m[idx];
      assert.ok(!seen.has(v), `${label} 중복: ${v}`);
      seen.set(v, true);
    }
  }
});

test('토큰 없는 쓰기 요청은 막힌다 (CSRF 방어)', async () => {
  const jar = makeJar();
  await signup(jar, 'csrf1', '토큰이');
  const p = await newPost(jar, 'CSRF 검사 글');

  // 다른 사이트가 흉내내듯, 쿠키는 있지만 토큰 없이 보낸 요청
  const res = await fetch(base + `/board/${p.id}/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...jar.header() },
    body: '', redirect: 'manual',
  });
  assert.equal(res.status, 403);
  assert.ok(db.prepare('SELECT 1 FROM posts WHERE id = ?').get(p.id), '글이 지워지면 안 된다');
});

test('남의 토큰을 가져다 써도 막힌다', async () => {
  const a = makeJar(); await signup(a, 'csrf2', '내세션');
  const b = makeJar(); await signup(b, 'csrf3', '남세션');
  const p = await newPost(a, '토큰 바꿔치기 검사 글');

  const res = await fetch(base + `/board/${p.id}/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...a.header() },
    body: form({ _csrf: await csrfToken(b) }), // b의 토큰을 a의 쿠키로
    redirect: 'manual',
  });
  assert.equal(res.status, 403);
  assert.ok(db.prepare('SELECT 1 FROM posts WHERE id = ?').get(p.id));
});

test('JSON 요청은 헤더로 토큰을 보낼 수 있다', async () => {
  const jar = makeJar();
  await signup(jar, 'csrf4', '헤더토큰');
  const res = await fetch(base + '/attendance/check', {
    method: 'POST',
    headers: { Accept: 'application/json', 'X-CSRF-Token': await csrfToken(jar), ...jar.header() },
    redirect: 'manual',
  });
  assert.equal(res.status, 200);

  // 헤더가 빠지면 막힌다
  const blocked = await fetch(base + '/attendance/check', {
    method: 'POST',
    headers: { Accept: 'application/json', ...jar.header() },
    redirect: 'manual',
  });
  assert.equal(blocked.status, 403);
  assert.match((await blocked.json()).error, /만료/);
});

test('모든 화면이 토큰을 내려준다', async () => {
  const jar = makeJar();
  await signup(jar, 'csrf5', '토큰확인');
  for (const url of ['/board', '/points', '/ranking', '/profile', '/notifications']) {
    const html = await (await get(url, jar)).text();
    assert.match(html, /name="csrf-token" content="[^"]+"/, `${url}에 토큰이 없다`);
  }
});

test('댓글이 20개를 넘으면 쪽으로 나뉜다', async () => {
  const jar = makeJar(); await signup(jar, 'cpage1', '쪽나눔이');
  const p = await newPost(jar, '댓글 많은 글');
  const label = (i) => `쪽나눔-${String(i).padStart(2, '0')}`;
  for (let i = 1; i <= 25; i++) await post(`/board/${p.id}/comments`, { content: label(i) }, jar);

  const first = await (await get(`/board/${p.id}`, jar)).text();
  assert.ok(first.includes(label(1)) && first.includes(label(20)), '1쪽에 앞 20개');
  assert.ok(!first.includes(label(21)), '21번째는 1쪽에 없어야 한다');
  assert.ok(first.includes('comment-pager'), '쪽 이동 링크가 있어야 한다');
  assert.ok(first.includes(`?cpage=2#comments`), '다음 쪽 링크');

  const second = await (await get(`/board/${p.id}?cpage=2`, jar)).text();
  assert.ok(second.includes(label(21)) && second.includes(label(25)), '2쪽에 나머지 5개');
  assert.ok(!second.includes(label(20)), '20번째는 2쪽에 없어야 한다');
  assert.ok(second.includes('댓글 <span class="accent">25</span>'), '댓글 수는 전체 기준');
});

test('댓글을 달면 그 댓글이 보이는 쪽으로 돌아간다', async () => {
  const jar = makeJar(); await signup(jar, 'cpage2', '되돌이');
  const p = await newPost(jar, '쪽 이동 확인 글');
  for (let i = 1; i <= 20; i++) await post(`/board/${p.id}/comments`, { content: `채우기${i}` }, jar);

  // 21번째 = 2쪽 첫 댓글
  const moved = await post(`/board/${p.id}/comments`, { content: '스물한번째' }, jar);
  assert.equal(moved.headers.get('location'), `/board/${p.id}?cpage=2#comments`);

  // 답글은 부모를 따라가므로 부모가 있는 1쪽으로 돌아간다
  const parent = db.prepare('SELECT id FROM comments WHERE post_id = ? ORDER BY id LIMIT 1').get(p.id);
  const reply = await post(`/board/${p.id}/comments`, { content: '답글', parent_id: String(parent.id) }, jar);
  assert.equal(reply.headers.get('location'), `/board/${p.id}#comments`);
});

test('없는 쪽을 요청해도 마지막 쪽을 보여준다', async () => {
  const jar = makeJar(); await signup(jar, 'cpage3', '범위밖');
  const p = await newPost(jar, '댓글 적은 글');
  await post(`/board/${p.id}/comments`, { content: '하나뿐인 댓글' }, jar);
  const html = await (await get(`/board/${p.id}?cpage=99`, jar)).text();
  assert.ok(html.includes('하나뿐인 댓글'));
  assert.ok(!html.includes('comment-pager'), '한 쪽뿐이면 이동 링크가 없다');
});

test('베스트댓글이 위아래로 겹쳐도 입력칸 id는 겹치지 않는다', async () => {
  const jar = makeJar(); await signup(jar, 'cbest1', '베스트글쓴이');
  const p = await newPost(jar, '베스트댓글 있는 글');
  await post(`/board/${p.id}/comments`, { content: '추천 많은 댓글' }, jar);
  const c = db.prepare('SELECT id FROM comments WHERE post_id = ?').get(p.id);
  for (const [u, n] of [['cbest2', '추천이1'], ['cbest3', '추천이2'], ['cbest4', '추천이3']]) {
    const j = makeJar(); await signup(j, u, n);
    await post(`/board/comments/${c.id}/like`, {}, j);
  }
  const html = await (await get(`/board/${p.id}`, jar)).text();
  assert.ok(html.includes('BEST'), '베스트댓글로 뽑혀야 한다');
  const ids = [...html.matchAll(/id="reply-([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, [`b${c.id}`, `${c.id}`], '위쪽 베스트 사본은 b를 붙여 구분한다');
  assert.equal(new Set(ids).size, ids.length, 'id가 겹치면 안 된다');
});
