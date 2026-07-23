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
    header: () => (cookie ? { Cookie: cookie } : {}),
    capture: (res) => { const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : []; for (const c of sc) { const m = c.match(/^connect\.sid=[^;]+/); if (m) cookie = m[0]; } },
  };
}
const form = (o) => new URLSearchParams(o).toString();
async function post(p, body, jar) {
  const res = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(jar ? jar.header() : {}) }, body: form(body), redirect: 'manual' });
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
  let blocked = false;
  for (let i = 0; i < 12; i++) {
    const res = await post('/login', { username: 'brute', password: 'wrong' + i });
    const body = await res.text();
    if (/시도가 너무 많아요/.test(body)) { blocked = true; break; }
  }
  assert.ok(blocked, '반복 실패 후 차단 메시지가 나와야 한다');
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
