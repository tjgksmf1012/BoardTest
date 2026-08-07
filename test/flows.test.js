// HTTP 상호작용 흐름 테스트: 출석·댓글·알림·스크랩·댓글좋아요·운영자추천·검색
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'boardtest-flow-')), 'test.db');
process.env.NODE_ENV = 'test';
// 첨부는 실제로 파일이 있는 것만 인정하므로, 시험용 업로드 폴더를 따로 둔다
process.env.UPLOAD_DIR = path.join(path.dirname(process.env.DB_PATH), 'uploads');
fs.mkdirSync(process.env.UPLOAD_DIR, { recursive: true });
const putFile = (name) => {
  fs.writeFileSync(path.join(process.env.UPLOAD_DIR, name), 'x');
  return name;
};

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

test('출석체크는 첫 회 +10P, 같은 날 재출석은 차단된다', async () => {
  const jar = makeJar();
  await signup(jar, 'att1', '출석이');
  const before = db.prepare("SELECT points FROM users WHERE username='att1'").get().points;
  await post('/attendance/check', {}, jar);
  const mid = db.prepare("SELECT points FROM users WHERE username='att1'").get().points;
  assert.equal(mid - before, 10);
  await post('/attendance/check', {}, jar); // 재출석
  const after = db.prepare("SELECT points FROM users WHERE username='att1'").get().points;
  assert.equal(after, mid); // 변화 없음
});

test('출석은 접속만으로 처리되지 않고 버튼을 눌러야 한다', async () => {
  const jar = makeJar();
  await signup(jar, 'attpop', '버튼이');
  // 게시판을 아무리 열어도 출석되지 않는다
  await get('/board', jar);
  await get('/board', jar);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM attendance WHERE user_id = ?").get(uid('attpop')).c, 0);

  const page = await (await get('/attendance', jar)).text();
  assert.ok(page.includes('오늘 출석체크 하기'), '출석 전에는 버튼이 보인다');
  await post('/attendance/check', {}, jar);
  const after = await (await get('/attendance', jar)).text();
  assert.ok(!after.includes('오늘 출석체크 하기'), '출석 후에는 버튼이 사라진다');
  assert.ok(after.includes('오늘 출석을 완료했어요'));
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
  assert.equal(d.awarded, 10);
  assert.equal(d.streak, 1);
  assert.equal(d.week.length, 7, '최근 7일 도장판');
  assert.equal(d.week[6].today, true, '마지막 칸이 오늘');
  assert.equal(d.week[6].checked, true, '오늘 칸에 도장이 찍혀 있어야 한다');
  assert.deepEqual({ days: d.next.days, remain: d.next.remain }, { days: 7, remain: 6 });
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
  assert.equal(first.awarded, 10);
  assert.equal(second.already, true);
  assert.equal(second.awarded, 0, '두 번째는 지급되지 않아야 한다');
  assert.equal(second.streak, 1, '이미 출석해도 연속일수는 그대로 알려준다');
  const logs = db.prepare(
    "SELECT COUNT(*) c FROM point_logs WHERE user_id = ? AND reason = 'attendance'"
  ).get(uid('attdup')).c;
  assert.equal(logs, 1);
});

test('7일 연속이면 보너스가 함께 지급된다', async () => {
  const jar = makeJar();
  await signup(jar, 'attmile', '연속이');
  const id = uid('attmile');
  const p = (n) => String(n).padStart(2, '0');
  const dayAgo = (o) => { const d = new Date(); d.setDate(d.getDate() - o);
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  [1, 2, 3, 4, 5, 6].forEach((o) => db.prepare('INSERT INTO attendance (user_id, day) VALUES (?, ?)').run(id, dayAgo(o)));

  const d = await (await fetch(base + '/attendance/check', {
    method: 'POST',
    headers: { Accept: 'application/json', 'X-CSRF-Token': await csrfToken(jar), ...jar.header() },
    redirect: 'manual',
  })).json();
  assert.equal(d.streak, 7);
  assert.equal(d.base, 10);
  assert.equal(d.bonus, 50, '7일 연속 보너스');
  assert.equal(d.awarded, 60);
  assert.equal(d.next.days, 14, '다음 목표는 14일');
});

test('비로그인 상태에서 출석 화면은 로그인으로 넘어간다', async () => {
  const res = await get('/attendance');
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /^\/login/);
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
    assert.equal(res.headers.get('location'), '/attendance', `막아야 함: ${bad}`);
  }
});

test('출석 화면은 연속일수·이번 달 횟수·30일 챌린지를 함께 보여준다', async () => {
  const jar = makeJar();
  await signup(jar, 'attold', '현황이');
  await post('/attendance/check', {}, jar);
  const html = await (await get('/attendance', jar)).text();
  assert.ok(html.includes('연속 출석'), '연속 출석 요약');
  assert.ok(html.includes('이번 달 출석'), '이번 달 요약');
  assert.ok(html.includes('30일 연속 출석 챌린지'), '30일 챌린지');
  assert.ok(html.includes('주차 출석 도전'), '주차별 도전');
  assert.ok(html.includes('출석 기록 보기'), '달력으로 가는 링크');
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

test('첨부에서 뺀 사진은 기록에서도 정리된다', async () => {
  // 사진은 본문과 따로 붙인다. 본문 HTML 을 뒤지지 않고 폼이 보낸 목록을 그대로 쓴다.
  const jar = makeJar();
  await signup(jar, 'imgs1', '사진이');
  putFile('a.png'); putFile('b.png');
  await post('/board', {
    category: '자유', title: '사진 글', content_format: 'html',
    content: '<p>사진 붙인 글</p>', images: 'a.png,b.png',
  }, jar);
  const p = db.prepare("SELECT * FROM posts WHERE title = '사진 글'").get();
  assert.equal(db.prepare('SELECT COUNT(*) c FROM post_images WHERE post_id = ?').get(p.id).c, 2);

  // 한 장만 남기고 수정
  await post(`/board/${p.id}/edit`, {
    category: '자유', title: '사진 글', content_format: 'html',
    content: '<p>사진 붙인 글</p>', images: 'a.png',
  }, jar);
  const rows = db.prepare('SELECT filename FROM post_images WHERE post_id = ?').all(p.id);
  assert.deepEqual(rows.map((r) => r.filename), ['a.png']);
});

test('첨부 순서가 그대로 저장된다', async () => {
  const jar = makeJar();
  await signup(jar, 'imgorder', '순서바꾼이');
  ['o1.png', 'o2.png', 'o3.png'].forEach(putFile);
  await post('/board', {
    category: '자유', title: '사진 순서 글', content_format: 'html',
    content: '<p>본문</p>', images: 'o3.png,o1.png,o2.png',
  }, jar);
  const p = db.prepare("SELECT id FROM posts WHERE title = '사진 순서 글'").get();
  const rows = db.prepare('SELECT filename FROM post_images WHERE post_id = ? ORDER BY sort').all(p.id);
  assert.deepEqual(rows.map((r) => r.filename), ['o3.png', 'o1.png', 'o2.png'], '끌어서 바꾼 순서대로');
});

test('없는 파일 이름이나 경로가 섞인 이름은 첨부되지 않는다', async () => {
  const jar = makeJar();
  await signup(jar, 'imgevil', '경로장난');
  putFile('real.png');
  await post('/board', {
    category: '자유', title: '이상한 첨부 글', content_format: 'html',
    content: '<p>본문</p>', images: 'real.png,../../etc/passwd,없는파일.png',
  }, jar);
  const p = db.prepare("SELECT id FROM posts WHERE title = '이상한 첨부 글'").get();
  const rows = db.prepare('SELECT filename FROM post_images WHERE post_id = ?').all(p.id);
  assert.deepEqual(rows.map((r) => r.filename), ['real.png']);
});


test('글은 연달아 못 올린다 (도배 막기)', async () => {
  const jar = makeJar();
  await signup(jar, 'spam1', '연달아쓴이');
  await newPost(jar, '연달아 1번째 글');
  await post('/board', { category: '자유', title: '연달아 2번째 글', content: '본문' }, jar);
  assert.ok(!db.prepare("SELECT 1 FROM posts WHERE title = '연달아 2번째 글'").get(),
    '30초 안에 두 번째 글이 올라가면 안 된다');

  // 시간이 지나면 다시 올라가야 한다.
  // created_at 은 localtime 으로 저장되는데 'now' 는 UTC 라, 이 둘을 그냥 빼면
  // 시차만큼 어긋나 두 번째 글부터 영영 막힌다. 그 회귀를 여기서 잡는다.
  db.prepare("UPDATE posts SET created_at = datetime(created_at, '-1 minute') WHERE user_id = ?")
    .run(uid('spam1'));
  await post('/board', { category: '자유', title: '한참 뒤에 쓴 글', content: '본문' }, jar);
  assert.ok(db.prepare("SELECT 1 FROM posts WHERE title = '한참 뒤에 쓴 글'").get(),
    '간격이 지났으면 올라가야 한다 (시간 기준이 어긋나면 여기서 걸린다)');
});

test('운영자는 공지를 연달아 올릴 수 있다', async () => {
  const jar = makeJar();
  await login(jar, 'admin', 'admin1234');
  await post('/board', { category: '자유', title: '운영자 연속 1', content: '본문', is_notice: '1' }, jar);
  await post('/board', { category: '자유', title: '운영자 연속 2', content: '본문', is_notice: '1' }, jar);
  assert.ok(db.prepare("SELECT 1 FROM posts WHERE title = '운영자 연속 2'").get(),
    '운영자는 공지를 이어서 올릴 일이 있다');
});

test('사진은 5장까지만 넣을 수 있다', async () => {
  const jar = makeJar();
  await signup(jar, 'imgmax', '장수제한');
  const six = Array.from({ length: 6 }, (_, i) => putFile(`x${i}.png`)).join(',');
  await post('/board', {
    category: '자유', title: '사진 6장 글', content_format: 'html',
    content: '<p>본문</p>', images: six,
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
  putFile('only.png');
  await post('/board', {
    category: '자유', title: '사진만 있는 글', content_format: 'html',
    content: '', images: 'only.png',
  }, jar);
  const p = db.prepare("SELECT id FROM posts WHERE title = '사진만 있는 글'").get();
  assert.ok(p, '사진이 곧 내용인 글도 있다');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM post_images WHERE post_id = ?').get(p.id).c, 1);
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
  assert.ok(html.includes('밤알바커뮤니티의 게시글이에요'));
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

test('추천 많은 댓글을 위에 복사해 두지 않는다', async () => {
  // 수정사항에서 베스트 뱃지를 빼라고 해, 사본만 남으면 같은 댓글이
  // 아무 표시 없이 두 번 나온다. 사본을 없애고 정렬로 대신한다.
  const jar = makeJar(); await signup(jar, 'cbest1', '베스트글쓴이');
  const p = await newPost(jar, '추천 많은 댓글이 있는 글');
  await post(`/board/${p.id}/comments`, { content: '추천 많은 댓글' }, jar);
  const c = db.prepare('SELECT id FROM comments WHERE post_id = ?').get(p.id);
  for (const [u, n] of [['cbest2', '추천이1'], ['cbest3', '추천이2'], ['cbest4', '추천이3']]) {
    const j = makeJar(); await signup(j, u, n);
    await post(`/board/comments/${c.id}/like`, {}, j);
  }
  const html = await (await get(`/board/${p.id}`, jar)).text();
  assert.ok(!html.includes('best-block'), '베스트 자리는 없앴다');
  const ids = [...html.matchAll(/id="comment-([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, [`${c.id}`], '댓글은 한 번만 그려진다');
});

test('댓글을 추천순으로 볼 수 있다', async () => {
  const jar = makeJar(); await signup(jar, 'csort1', '정렬글쓴이');
  const p = await newPost(jar, '댓글 정렬 확인 글');
  await post(`/board/${p.id}/comments`, { content: '먼저 쓴 댓글' }, jar);
  await post(`/board/${p.id}/comments`, { content: '나중에 쓴 댓글' }, jar);
  const [first, second] = db.prepare('SELECT id FROM comments WHERE post_id = ? ORDER BY id').all(p.id);
  const j = makeJar(); await signup(j, 'csort2', '추천누른이');
  await post(`/board/comments/${second.id}/like`, {}, j);

  const order = (html) => [...html.matchAll(/id="comment-(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(order(await (await get(`/board/${p.id}`, jar)).text()), [first.id, second.id], '기본은 최신순(쓴 순서)');
  assert.deepEqual(order(await (await get(`/board/${p.id}?csort=like`, jar)).text()), [second.id, first.id], '추천순은 추천 많은 것이 위로');
});

// ---- 실시간 알림 (SSE) -------------------------------------------------------

// 서버 쪽만 시험하다 보니, 브라우저에서 스트림에 붙는 코드가 아예 없는데도
// 아래 시험들이 전부 통과하고 있었다. 화면에 그 코드가 실려 나가는지도 본다.
test('로그인한 화면에는 알림 스트림에 붙는 코드가 실려 나간다', async () => {
  const jar = makeJar();
  await signup(jar, 'sseclient', '실시간이');
  const html = await (await get('/board', jar)).text();
  assert.match(html, /new EventSource\('\/notifications\/stream'\)/, '스트림에 붙는 코드가 없다');
  assert.match(html, /addEventListener\('notify'/,
    "서버는 event: notify 로 보낸다 — onmessage 만 걸면 아무것도 안 온다");
  assert.match(html, /\/notifications\/count/, '스트림을 못 쓸 때 대신 물어볼 곳이 없다');
});

test('로그인하지 않았으면 스트림에 붙지 않는다', async () => {
  const html = await (await get('/board')).text();
  assert.ok(!html.includes('new EventSource'), '비회원이 알림 스트림을 열 이유가 없다');
});

const realtime = require('../src/realtime');
test.after(() => realtime.closeAll());

// 서버가 흘려보내는 이벤트를 한 개씩 꺼내 읽는 도우미
function sseReader(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const queue = [];
  const waiters = [];
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = {};
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event: ')) ev.event = line.slice(7);
            else if (line.startsWith('data: ')) ev.data = JSON.parse(line.slice(6));
          }
          if (ev.event) { const w = waiters.shift(); if (w) w(ev); else queue.push(ev); }
        }
      }
    } catch { /* 연결을 끊으면 여기로 온다 */ }
  })();
  return {
    next(ms = 3000) {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('이벤트가 오지 않았다')), ms);
        waiters.push((ev) => { clearTimeout(t); resolve(ev); });
      });
    },
    close() { reader.cancel().catch(() => {}); },
  };
}

async function openStream(jar) {
  const res = await fetch(base + '/notifications/stream', { headers: jar.header() });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  return sseReader(res);
}

// 연결이 끊기는 시점은 서버가 알아채는 대로라 잠깐 기다려준다
async function until(fn, ms = 2000) {
  const end = Date.now() + ms;
  for (;;) {
    if (fn()) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('알림이 생기면 열어둔 화면으로 곧바로 전달된다', async () => {
  const owner = makeJar(); await signup(owner, 'sse1', '실시간주인');
  const guest = makeJar(); await signup(guest, 'sse2', '실시간손님');
  const p = await newPost(owner, '실시간 알림 확인 글');

  const stream = await openStream(owner);
  const ready = await stream.next();
  assert.equal(ready.event, 'ready');
  assert.equal(ready.data.unread, 0);

  await post(`/board/${p.id}/comments`, { content: '실시간 댓글' }, guest);
  const ev = await stream.next();
  assert.equal(ev.event, 'notify');
  assert.match(ev.data.message, /댓글을 남겼어요/);
  assert.equal(ev.data.link, `/board/${p.id}`);
  assert.equal(ev.data.unread, 1);

  stream.close();
  await until(() => realtime.connectionCount(uid('sse1')) === 0);
});

test('내가 한 일로는 내 화면에 알림이 오지 않는다', async () => {
  const jar = makeJar(); await signup(jar, 'sse3', '혼잣말');
  const p = await newPost(jar, '내가 내 글에 댓글 다는 글');
  const stream = await openStream(jar);
  await stream.next(); // ready
  await post(`/board/${p.id}/comments`, { content: '내 댓글' }, jar);
  await assert.rejects(stream.next(300), /오지 않았다/);
  stream.close();
});

test('로그인하지 않으면 실시간 연결을 열 수 없다', async () => {
  const res = await fetch(base + '/notifications/stream');
  assert.equal(res.status, 401);
  await res.text();
});

test('탭을 너무 많이 열면 오래된 연결부터 정리된다', async () => {
  const jar = makeJar(); await signup(jar, 'sse4', '탭부자');
  const id = uid('sse4');
  const opened = [];
  for (let i = 0; i < realtime.MAX_PER_USER + 2; i++) {
    const s = await openStream(jar);
    await s.next(); // ready까지 받아야 연결이 잡힌 것
    opened.push(s);
  }
  assert.ok(await until(() => realtime.connectionCount(id) === realtime.MAX_PER_USER),
    `열린 연결이 ${realtime.MAX_PER_USER}개로 제한돼야 한다 (지금 ${realtime.connectionCount(id)})`);
  opened.forEach((s) => s.close());
  await until(() => realtime.connectionCount(id) === 0);
});

test('연결을 못 여는 환경을 위해 안 읽은 개수를 따로 알려준다', async () => {
  const owner = makeJar(); await signup(owner, 'sse5', '개수확인');
  const guest = makeJar(); await signup(guest, 'sse6', '개수손님');
  const p = await newPost(owner, '개수 확인용 글');
  assert.deepEqual(await (await get('/notifications/count', owner)).json(), { unread: 0 });
  await post(`/board/${p.id}/comments`, { content: '댓글이요' }, guest);
  assert.deepEqual(await (await get('/notifications/count', owner)).json(), { unread: 1 });
  const anon = await get('/notifications/count');
  assert.equal(anon.status, 302); // 로그인 화면으로
});

// ---- 점 3개(더보기) 메뉴 -------------------------------------------------------
// 기획안: 다른 사람의 글·댓글 → 신고하기 / 내가 쓴 글·댓글 → 수정·삭제 / 운영자 → 숨김 처리
test('점 3개 메뉴에는 그 사람이 할 수 있는 일만 담긴다', async () => {
  const owner = makeJar(); await signup(owner, 'menu1', '메뉴주인');
  const guest = makeJar(); await signup(guest, 'menu2', '메뉴손님');
  const p = await newPost(owner, '점 3개 메뉴 확인 글');

  const mine = await (await get(`/board/${p.id}`, owner)).text();
  assert.ok(mine.includes('수정하기') && mine.includes('삭제하기'), '내 글이면 수정·삭제');
  assert.ok(!mine.includes('신고하기'), '내 글은 신고할 수 없다');

  const theirs = await (await get(`/board/${p.id}`, guest)).text();
  assert.ok(theirs.includes('신고하기'), '남의 글이면 신고');
  assert.ok(!theirs.includes('수정하기') && !theirs.includes('삭제하기'), '남의 글은 고치거나 지울 수 없다');
  assert.ok(!theirs.includes('숨김 처리'), '일반 회원에겐 운영자 기능이 없다');

  const admin = makeJar(); await login(admin, 'admin', 'admin1234');
  const asAdmin = await (await get(`/board/${p.id}`, admin)).text();
  assert.ok(asAdmin.includes('숨김 처리') && asAdmin.includes('운영자 추천'), '운영자 기능은 메뉴 안에');
  assert.ok(asAdmin.includes('삭제하기'), '운영자는 남의 글도 지울 수 있다');
});

test('메뉴는 자바스크립트가 열기 전까지 닫혀 있다', async () => {
  const jar = makeJar(); await signup(jar, 'menu3', '닫힘확인');
  const p = await newPost(jar, '메뉴 초기 상태 글');
  const html = await (await get(`/board/${p.id}`, jar)).text();
  assert.match(html, /<div class="menu-pop" role="menu" hidden>/, '처음에는 hidden');
  assert.match(html, /aria-expanded="false"/, '처음에는 접힌 상태로 알린다');
});

test('로그인하지 않으면 점 3개 메뉴가 아예 없다', async () => {
  const jar = makeJar(); await signup(jar, 'menu4', '비회원용글쓴이');
  const p = await newPost(jar, '비회원이 보는 글');
  const html = await (await get(`/board/${p.id}`)).text();
  // 'menu-btn'은 공용 스크립트에도 들어 있으니 실제 버튼 태그로 확인한다
  assert.ok(!html.includes('<button class="menu-btn"'), '할 수 있는 게 없으면 버튼도 두지 않는다');
  assert.ok(!html.includes('<div class="menu-pop"'), '메뉴 내용도 없어야 한다');
});

// ---- 캐릭터 상점 (2단계) -------------------------------------------------------
const avatarCatalog = require('../src/avatars');

test('여성회원은 가입할 때 무료 캐릭터를 직접 고른다', async () => {
  const choices = avatarCatalog.starterFor('female').choices;
  const want = choices[2];                       // 첫 번째가 아닌 것을 골라야 의미가 있다
  const jar = makeJar();
  await post('/signup', { username: 'pick1', nickname: '고른사람', password: 'password123',
    member_type: 'female', avatar_id: want.code }, jar);
  assert.equal(db.prepare("SELECT avatar_id FROM users WHERE username='pick1'").get().avatar_id, want.code);
});

test('고를 수 없는 캐릭터를 보내면 무시하고 기본값을 준다', async () => {
  const paid = avatarCatalog.characters('female').find((i) => i.price > 0);
  const jar = makeJar();
  await post('/signup', { username: 'pick2', nickname: '몰래산사람', password: 'password123',
    member_type: 'female', avatar_id: paid.code }, jar);
  const got = db.prepare("SELECT avatar_id FROM users WHERE username='pick2'").get().avatar_id;
  assert.notEqual(got, paid.code, '돈 내지 않은 캐릭터가 붙으면 안 된다');
  assert.equal(avatarCatalog.get(got).price, 0);
});

test('상점 1단계에는 기본 캐릭터만, 2단계에 스타일 25종이 나온다', async () => {
  const jar = makeJar();
  await post('/signup', { username: 'shop1', nickname: '상점구경', password: 'password123',
    member_type: 'female' }, jar);

  const first = await (await get('/profile?tab=avatar', jar)).text();
  const themes = avatarCatalog.themes('female');
  assert.ok(first.includes(themes[0].name), '1단계에 테마 이름이 보인다');
  assert.ok(first.includes(`theme=${themes[0].code}`), '눌러서 들어갈 링크가 있다');
  assert.equal((first.match(/class="style-cell/g) || []).length, 0, '1단계에서는 개별 스타일을 펼치지 않는다');
  assert.equal((first.match(/class="theme-cell/g) || []).length, themes.length, '기본 캐릭터 9칸');

  const t = themes.find((x) => x.code === 'redqueen') || themes[1];
  const second = await (await get(`/profile?tab=avatar&theme=${t.code}`, jar)).text();
  const shown = (second.match(/class="style-cell/g) || []).length;
  assert.equal(shown, 25, `2단계에 25칸이 나와야 하는데 ${shown}칸이다`);
  assert.ok(second.includes(t.note), '고른 캐릭터 소개가 보인다');
  assert.ok(second.includes('선택 스타일'), '아래 선택 바가 있다');
});

test('상점 2단계 칩으로 걸러 볼 수 있다', async () => {
  const jar = makeJar();
  await post('/signup', { username: 'shop4', nickname: '칩눌러보는이', password: 'password123',
    member_type: 'female' }, jar);
  const t = avatarCatalog.themes('female').find((x) => x.code === 'redqueen');
  const count = async (q) => ((await (await get(`/profile?tab=avatar&theme=${t.code}${q}`, jar)).text())
    .match(/class="style-cell/g) || []).length;

  assert.equal(await count(''), 25, '전체는 25칸');
  assert.equal(await count('&f=hair'), 25, '헤어별로 묶어도 총 25칸');
  assert.equal(await count('&f=outfit'), 25, '의상별로 묶어도 총 25칸');
  assert.equal(await count('&f=popular'), 25, '인기순도 25칸');
  assert.equal(await count('&f=owned'), 0, '아직 산 게 없으면 보유중은 비어 있다');

  const hair = await (await get(`/profile?tab=avatar&theme=${t.code}&f=hair`, jar)).text();
  assert.ok(hair.includes('헤어 1') && hair.includes('헤어 5'), '헤어별 묶음 제목이 붙는다');
});

test('사면 바로 장착되고 보유중에도 잡힌다', async () => {
  const jar = makeJar();
  await post('/signup', { username: 'shop5', nickname: '바로장착러', password: 'password123',
    member_type: 'female' }, jar);
  const id = uid('shop5');
  const t = avatarCatalog.themes('female').find((x) => x.code === 'chicblack');
  const want = t.items[7];                       // 08번 (시안과 같은 자리)
  db.prepare('UPDATE users SET points = ? WHERE id = ?').run(want.price, id);

  await post('/profile/buy', { code: want.code, theme: t.code, f: 'all' }, jar);
  assert.equal(db.prepare('SELECT avatar_id FROM users WHERE id = ?').get(id).avatar_id, want.code,
    '구매 후 즉시 적용');

  const owned = await (await get(`/profile?tab=avatar&theme=${t.code}&f=owned`, jar)).text();
  assert.equal((owned.match(/class="style-cell/g) || []).length, 1, '보유중에 한 칸');
});

test('포인트가 모자라면 캐릭터를 살 수 없다', async () => {
  const jar = makeJar();
  await post('/signup', { username: 'shop2', nickname: '가난한사람', password: 'password123',
    member_type: 'female' }, jar);
  const id = uid('shop2');
  db.prepare('UPDATE users SET points = 100 WHERE id = ?').run(id);
  const paid = avatarCatalog.characters('female').find((i) => i.price > 0);

  await post('/profile/buy', { code: paid.code, theme: paid.themeCode }, jar);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM user_items WHERE user_id = ?').get(id).c, 0);
  assert.equal(db.prepare('SELECT points FROM users WHERE id = ?').get(id).points, 100, '포인트도 그대로');

  // 살 수 있게 되면 사지고, 보던 스타일 목록으로 돌아온다
  db.prepare('UPDATE users SET points = ? WHERE id = ?').run(paid.price, id);
  const res = await post('/profile/buy', { code: paid.code, theme: paid.themeCode }, jar);
  assert.match(res.headers.get('location'), new RegExp(`theme=${paid.themeCode}`));
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM user_items WHERE user_id = ?').get(id).c, 1);
  assert.equal(db.prepare('SELECT points FROM users WHERE id = ?').get(id).points, 0);
  // 쓴 포인트도 내역에 남는다
  const log = db.prepare("SELECT amount FROM point_logs WHERE user_id = ? AND reason = 'purchase'").get(id);
  assert.equal(log.amount, -paid.price);
});

test('다른 유형의 캐릭터는 사지지 않는다', async () => {
  const jar = makeJar();
  await post('/signup', { username: 'shop3', nickname: '남성회원A', password: 'password123',
    member_type: 'male' }, jar);
  const id = uid('shop3');
  db.prepare('UPDATE users SET points = 999999 WHERE id = ?').run(id);
  const female = avatarCatalog.characters('female').find((i) => i.price > 0);
  await post('/profile/buy', { code: female.code }, jar);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM user_items WHERE user_id = ?').get(id).c, 0);
});

// ---- 이전글·다음글 -----------------------------------------------------------
// 규칙: '방금 보던 목록에서 내 윗줄·아랫줄' 이다.
// 어느 탭에서 들어왔는지를 그대로 따라가고, 공지는 뺀다.
//
// 이 검사가 왜 있냐면, 처음에는 탭 정보가 없을 때 그 글의 말머리로 가뒀다.
// 그래서 전체 목록에서 2번째 글을 눌렀는데 이전글이 8번째 글로 튀었다.
// 화면에는 오류가 없고 링크도 멀쩡해서 눌러 보기 전에는 모른다.
test('이전글·다음글은 들어온 탭을 따라간다', async () => {
  const ins = db.prepare(
    "INSERT INTO posts (user_id, category, title, content, is_notice) VALUES (?, ?, ?, 'x', ?)");
  const uid = db.prepare('SELECT id FROM users LIMIT 1').get().id;
  // 자유 · 질문 · 자유 · 질문 순으로 번갈아 넣는다
  const a = ins.run(uid, '자유', 'nav-자유-1', 0).lastInsertRowid;
  const b = ins.run(uid, '질문', 'nav-질문-1', 0).lastInsertRowid;
  const c = ins.run(uid, '자유', 'nav-자유-2', 0).lastInsertRowid;
  const d = ins.run(uid, '질문', 'nav-질문-2', 0).lastInsertRowid;
  const notice = ins.run(uid, '자유', 'nav-공지', 1).lastInsertRowid;
  const e = ins.run(uid, '자유', 'nav-자유-3', 0).lastInsertRowid;

  const navOf = async (id, qs) => {
    const html = await (await fetch(`${base}/board/${id}${qs || ''}`)).text();
    const box = (html.match(/<nav class="prev-next"[\s\S]*?<\/nav>/) || [''])[0];
    return [...box.matchAll(/href="\/board\/(\d+)/g)].map((m) => Number(m[1]));
  };

  // 전체 탭 (말머리 없음) — 번호 순으로 바로 앞뒤
  assert.deepEqual(await navOf(c), [b, d],
    '전체에서 들어오면 말머리와 상관없이 목록의 윗줄·아랫줄이어야 한다');

  // 자유 탭 — 자유끼리
  assert.deepEqual(await navOf(c, '?category=' + encodeURIComponent('자유')), [a, e],
    '자유 탭에서 들어오면 자유 글끼리 이어져야 한다');

  // 질문 탭 — 질문끼리.
  // d 는 방금 넣은 것 중 제일 나중이라 '다음글' 이 없고 이전글만 b 가 나와야 한다.
  // (b 에서 재면 데모 데이터의 옛 질문 글이 이전글로 걸려서 기대값이 지저분해진다)
  assert.deepEqual(await navOf(d, '?category=' + encodeURIComponent('질문')), [b],
    '질문 탭에서 들어오면 질문 글끼리 이어져야 한다');

  // 공지는 어느 쪽에서도 안 끼어든다
  assert.ok(!(await navOf(e)).includes(notice), '공지가 이전글로 나오면 안 된다');
  assert.ok(!(await navOf(c, '?category=' + encodeURIComponent('자유'))).includes(notice),
    '말머리 탭에서도 공지는 빠져야 한다');

  for (const id of [a, b, c, d, e, notice]) db.prepare('DELETE FROM posts WHERE id = ?').run(id);
});

// 검색·정렬까지 따라가는지.
// 목록을 거르는 조건과 이전글·다음글의 조건이 어긋나면
// '목록에는 있는데 다음글로는 안 넘어가는' 글이 생긴다. 오류가 안 나서 알기 어렵다.
test('이전글·다음글이 검색어와 정렬도 따라간다', async () => {
  const ins = db.prepare(
    `INSERT INTO posts (user_id, category, title, content, content_text, like_count, views, is_notice)
     VALUES (?, '자유', ?, ?, ?, ?, ?, 0)`);
  const uid = db.prepare('SELECT id FROM users LIMIT 1').get().id;
  // 검색어 '깐깐이' 가 든 글 셋과, 안 든 글 둘을 사이사이에 끼운다
  const mk = (t, body, likes, views) => {
    const id = ins.run(uid, t, body, body, likes, views).lastInsertRowid;
    require('../src/search').indexPost(id, t, body);
    return id;
  };
  const a = mk('깐깐이 첫째', '깐깐이 본문', 1, 100);
  const x = mk('상관없는 글1', '아무 내용', 50, 5000);
  const b = mk('깐깐이 둘째', '깐깐이 본문', 9, 300);
  const y = mk('상관없는 글2', '아무 내용', 60, 6000);
  const c = mk('깐깐이 셋째', '깐깐이 본문', 5, 200);

  const navOf = async (id, qs) => {
    const html = await (await fetch(`${base}/board/${id}${qs || ''}`)).text();
    const box = (html.match(/<nav class="prev-next"[\s\S]*?<\/nav>/) || [''])[0];
    return [...box.matchAll(/href="\/board\/(\d+)/g)].map((m) => Number(m[1]));
  };

  // 검색 결과 안에서만 이어져야 한다 — 사이에 낀 x·y 는 건너뛴다
  assert.deepEqual(await navOf(b, '?q=' + encodeURIComponent('깐깐이')), [a, c],
    '검색해서 들어오면 검색 결과 안에서만 이어져야 한다');
  // 검색 없이 들어오면 바로 옆 글(x·y)이 나온다
  assert.deepEqual(await navOf(b), [x, y], '검색이 없으면 번호 순으로 바로 옆 글');

  // 추천순: 추천 수가 큰 순서 (b 9 > y 60? 아니다 — 검색을 걸어 셋만 놓고 본다)
  // 깐깐이 글의 추천은 a 1 · c 5 · b 9 → 추천순 목록은 b, c, a
  // c 에서 보면 '한 칸 아래(추천 적은 쪽)' 는 a, '한 칸 위' 는 b
  assert.deepEqual(await navOf(c, '?q=' + encodeURIComponent('깐깐이') + '&sort=likes'), [a, b],
    '추천순이면 추천 수 차례로 이어져야 한다');

  // 조회순: a 100 · c 200 · b 300 → 목록은 b, c, a. c 의 아래는 a, 위는 b
  assert.deepEqual(await navOf(c, '?q=' + encodeURIComponent('깐깐이') + '&sort=views'), [a, b],
    '조회순이면 조회 수 차례로 이어져야 한다');

  for (const id of [a, b, c, x, y]) db.prepare('DELETE FROM posts WHERE id = ?').run(id);
});

// ---- 랭킹 --------------------------------------------------------------------
// 목록에서 빼는 조건과 프로필의 '랭킹 N위' 를 세는 조건이 어긋나면,
// 랭킹 1위인 사람 프로필에 2위라고 적히고 랭킹에 없는 사람한테도 등수가 찍힌다.
// 실제로 그랬다 — 운영자를 세고 있어서 목록 1위가 프로필에서 2위였다.
//
// 목록은 TOP 20 까지만 보여 준다. 그래서 '자격이 있는가' 와 '상위 20위 안인가' 는 다르다.
// 21위인 사람은 목록에 없어도 순위는 있어야 한다.
const rankEligible = (u) => !u.is_admin && !u.is_banned && u.member_type === 'female';

async function rankedIds() {
  const html = await (await fetch(`${base}/ranking`)).text();
  return [...new Set([...html.matchAll(/class="author-link" href="\/users\/(\d+)">/g)]
    .map((m) => Number(m[1])))];
}

test('랭킹 목록에 나오는 사람은 자격이 있는 사람뿐이다', async () => {
  const ids = await rankedIds();
  assert.ok(ids.length >= 2, '랭킹에 사람이 너무 적어 견줄 수가 없다');
  const byId = new Map(db.prepare(
    'SELECT id, nickname, is_admin, is_banned, member_type FROM users').all().map((u) => [u.id, u]));
  for (const id of ids) {
    const u = byId.get(id);
    assert.ok(rankEligible(u),
      `${u.nickname}(${u.member_type}${u.is_admin ? '·운영자' : ''}${u.is_banned ? '·제재' : ''})`
      + ' 가 랭킹에 나온다');
  }
  // 자격 있는 사람 중 포인트 1등은 반드시 목록 1위여야 한다
  const top = db.prepare(
    `SELECT id, nickname FROM users u
      WHERE u.is_admin = 0 AND u.is_banned = 0 AND u.member_type = 'female'
      ORDER BY u.points DESC, u.id LIMIT 1`).get();
  assert.strictEqual(ids[0], top.id, `목록 1위가 ${top.nickname} 이어야 한다`);
});

test('프로필의 랭킹 순위가 목록과 어긋나지 않는다', async () => {
  const ids = await rankedIds();
  const users = db.prepare(
    'SELECT id, nickname, is_admin, is_banned, member_type FROM users').all();
  let checkedIn = 0;
  let checkedOut = 0;
  for (const u of users) {
    const html = await (await fetch(`${base}/users/${u.id}`)).text();
    if (!html.includes('profile-stats')) continue;      // 내 프로필은 /profile 로 넘어간다
    const shown = (html.match(/랭킹 (\d+)위/) || [])[1];
    const pos = ids.indexOf(u.id);
    if (pos >= 0) {
      assert.strictEqual(shown, String(pos + 1),
        `${u.nickname}: 목록 ${pos + 1}위인데 프로필은 ${shown || '순위 없음'}`);
      checkedIn++;
    } else if (rankEligible(u)) {
      // 상위 20위 밖 — 목록에는 없지만 순위는 있어야 하고, 20보다 뒤여야 한다
      assert.ok(shown && Number(shown) > ids.length,
        `${u.nickname}: 상위 20위 밖인데 프로필 순위가 ${shown || '없음'}`);
    } else {
      assert.strictEqual(shown, undefined,
        `${u.nickname}: 랭킹 자격이 없는데 프로필에 ${shown}위라고 적힌다`);
      checkedOut++;
    }
  }
  assert.ok(checkedIn >= 2, '목록에 든 사람을 못 견줬다');
  assert.ok(checkedOut >= 1, '자격 없는 사람을 한 명도 못 견줬다');
});

// ---- 베스트댓글 ---------------------------------------------------------------
// 한 번 뺐다가 다시 넣은 기능이다.
// 처음에는 좋아요 많은 댓글을 맨 위에 '복사해서' 보여 줬는데, 뱃지를 떼자 같은 댓글이
// 아무 표시 없이 위아래 두 번 나왔다. 그래서 이번엔 복사하지 않고 자리를 옮긴다.
// 그 차이가 되돌아가지 않게 '한 번만 나오는지' 를 검사에 박아 둔다.
test('좋아요 5개부터 베스트, 4개는 안 된다', async () => {
  const jar = makeJar();
  await signup(jar, 'best_' + Date.now(), '베스트시험');
  const pid = db.prepare(
    "INSERT INTO posts (user_id, category, title, content) VALUES (?, '자유', '베스트 시험글', 'x')")
    .run(db.prepare('SELECT id FROM users LIMIT 1').get().id).lastInsertRowid;

  const uid = db.prepare('SELECT id FROM users LIMIT 1').get().id;
  const mk = (text) => db.prepare(
    'INSERT INTO comments (post_id, user_id, parent_id, content) VALUES (?, ?, NULL, ?)')
    .run(pid, uid, text).lastInsertRowid;
  const five = mk('좋아요 다섯개짜리');
  const four = mk('좋아요 네개짜리');
  const zero = mk('좋아요 없는 것');

  // 좋아요를 넣을 사람들
  const likers = db.prepare('SELECT id FROM users LIMIT 6').all().map((r) => r.id);
  const like = db.prepare('INSERT OR IGNORE INTO comment_likes (comment_id, user_id) VALUES (?, ?)');
  likers.slice(0, 5).forEach((u) => like.run(five, u));
  likers.slice(0, 4).forEach((u) => like.run(four, u));

  const html = await (await fetch(`${base}/board/${pid}`)).text();

  const bestIds = [...html.matchAll(/<div class="comment[^"]*\bbest\b[^"]*" id="comment-(\d+)"/g)]
    .map((m) => Number(m[1]));
  assert.deepEqual(bestIds, [five], '좋아요 5개짜리만 베스트여야 한다');
  assert.ok(!bestIds.includes(four), '좋아요 4개는 베스트가 되면 안 된다');

  // 같은 댓글이 두 번 나오면 안 된다 (예전에 지적받은 것)
  for (const id of [five, four, zero]) {
    const n = (html.match(new RegExp(`id="comment-${id}"`, 'g')) || []).length;
    assert.strictEqual(n, 1, `댓글 ${id} 가 ${n}번 나온다 — 복사본이 생겼다`);
  }

  // 베스트는 맨 위에 있어야 한다
  const order = [...html.matchAll(/id="comment-(\d+)"/g)].map((m) => Number(m[1]));
  assert.strictEqual(order[0], five, '베스트 댓글이 맨 위에 있어야 한다');

  assert.match(html, /badge-best">베스트</, '베스트 뱃지가 보여야 한다');

  db.prepare('DELETE FROM posts WHERE id = ?').run(pid);
});

test('답글은 베스트로 떼어 올리지 않는다', async () => {
  // 답글을 위로 올리면 부모와 떨어져 무슨 말인지 알 수 없게 된다
  const uid = db.prepare('SELECT id FROM users LIMIT 1').get().id;
  const pid = db.prepare(
    "INSERT INTO posts (user_id, category, title, content) VALUES (?, '자유', '답글 시험글', 'x')")
    .run(uid).lastInsertRowid;
  const parent = db.prepare(
    'INSERT INTO comments (post_id, user_id, parent_id, content) VALUES (?, ?, NULL, ?)')
    .run(pid, uid, '부모 댓글').lastInsertRowid;
  const reply = db.prepare(
    'INSERT INTO comments (post_id, user_id, parent_id, content) VALUES (?, ?, ?, ?)')
    .run(pid, uid, parent, '좋아요 많은 답글').lastInsertRowid;

  const like = db.prepare('INSERT OR IGNORE INTO comment_likes (comment_id, user_id) VALUES (?, ?)');
  db.prepare('SELECT id FROM users LIMIT 6').all().forEach((r) => like.run(reply, r.id));

  const html = await (await fetch(`${base}/board/${pid}`)).text();
  const order = [...html.matchAll(/id="comment-(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(order, [parent, reply], '답글은 부모 아래에 그대로 있어야 한다');
  assert.ok(!/class="comment[^"]*\bbest\b/.test(html), '답글은 베스트가 되면 안 된다');

  db.prepare('DELETE FROM posts WHERE id = ?').run(pid);
});

test('베스트는 상위 2개까지만 올라간다', async () => {
  // 처음 만들었을 때도 상위 2개였다 (에브리타임식).
  // 기준만 넘으면 전부 올리면 댓글 많은 글에서 절반이 '베스트' 가 되어 뱃지가 뜻을 잃는다.
  const uid = db.prepare('SELECT id FROM users LIMIT 1').get().id;
  const pid = db.prepare(
    "INSERT INTO posts (user_id, category, title, content) VALUES (?, '자유', '베스트 개수 시험', 'x')")
    .run(uid).lastInsertRowid;
  const likers = db.prepare('SELECT id FROM users LIMIT 9').all().map((r) => r.id);
  assert.ok(likers.length >= 8, '좋아요 눌러 줄 사람이 모자라 시험을 못 한다');

  const like = db.prepare('INSERT OR IGNORE INTO comment_likes (comment_id, user_id) VALUES (?, ?)');
  const ids = [];
  // 좋아요 8·7·6·5 개짜리 넷 — 전부 기준(5)을 넘는다
  [8, 7, 6, 5].forEach((n, i) => {
    const cid = db.prepare(
      'INSERT INTO comments (post_id, user_id, parent_id, content) VALUES (?, ?, NULL, ?)')
      .run(pid, uid, `좋아요 ${n}개짜리`).lastInsertRowid;
    likers.slice(0, n).forEach((u) => like.run(cid, u));
    ids.push(cid);
  });

  const html = await (await fetch(`${base}/board/${pid}`)).text();
  const bestIds = [...html.matchAll(/<div class="comment[^"]*\bbest\b[^"]*" id="comment-(\d+)"/g)]
    .map((m) => Number(m[1]));
  assert.strictEqual(bestIds.length, 2,
    `기준을 넘은 댓글이 4개인데 베스트가 ${bestIds.length}개다 — 상위 2개까지만이어야 한다`);
  assert.deepEqual(bestIds, [ids[0], ids[1]], '좋아요가 많은 순으로 두 개여야 한다');

  db.prepare('DELETE FROM posts WHERE id = ?').run(pid);
});

// ---- 닉네임 검색 --------------------------------------------------------------
// 닉네임으로도 글을 찾을 수 있어야 한다.
// 다만 익명 글은 절대 걸리면 안 된다 — 닉네임으로 검색해서 그 사람 익명 글이 나오면
// 화면에 '익명' 이라고 적혀 있어도 누가 썼는지 드러난다.
test('닉네임으로 검색하면 그 사람 글이 나온다', async () => {
  const nick = '검색용닉' + Date.now().toString().slice(-5);
  const uid = db.prepare(
    "INSERT INTO users (username, password_hash, nickname, points, avatar_id, is_admin, member_type)"
    + " VALUES (?, '', ?, 0, '', 0, 'female')")
    .run('search_' + Date.now(), nick).lastInsertRowid;

  const mk = (title, anon) => db.prepare(
    'INSERT INTO posts (user_id, category, title, content, content_text, is_anonymous)'
    + " VALUES (?, '자유', ?, 'zzz', 'zzz', ?)").run(uid, title, anon).lastInsertRowid;
  const open = mk('닉검색 드러난글', 0);
  const anon = mk('닉검색 익명글', 1);
  for (const id of [open, anon]) {
    const r = db.prepare('SELECT title, content_text FROM posts WHERE id = ?').get(id);
    require('../src/search').indexPost(id, r.title, r.content_text);
  }

  const find = async (q) => {
    const html = await (await fetch(`${base}/board?q=${encodeURIComponent(q)}`)).text();
    return [...html.matchAll(/href="\/board\/(\d+)/g)].map((m) => Number(m[1]));
  };

  const hit = await find(nick);
  assert.ok(hit.includes(open), '닉네임으로 검색하면 그 사람 글이 나와야 한다');
  assert.ok(!hit.includes(anon),
    '익명 글이 닉네임 검색에 걸리면 안 된다 — 누가 썼는지 드러난다');

  // 닉네임 일부만 쳐도 찾아진다
  const part = await find(nick.slice(0, 4));
  assert.ok(part.includes(open), '닉네임 일부로도 찾아져야 한다');

  // 제목 검색은 그대로 된다 (익명이든 아니든)
  const byTitle = await find('닉검색');
  assert.ok(byTitle.includes(open) && byTitle.includes(anon),
    '제목 검색은 익명 글도 나와야 한다 (누가 썼는지는 안 드러난다)');

  db.prepare('DELETE FROM posts WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM users WHERE id = ?').run(uid);
});
