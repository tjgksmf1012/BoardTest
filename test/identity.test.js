// A사이트 연동(host) 모드 테스트
//
// 이 커뮤니티는 이미 회원을 가진 알바채용 사이트 안에 들어간다.
// 그 사람에게 계정을 두 번 만들게 하지 않는 것이 이 모드의 목적이므로,
// '가입 없이 첫 방문에 프로필이 생기는가'와 '아무 토큰이나 통하지는 않는가'를 확인한다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'boardtest-host-')), 'test.db');
process.env.NODE_ENV = 'test';
process.env.AUTH_MODE = 'host';
process.env.HOST_SSO_SECRET = 'test-secret-for-host-mode';
process.env.HOST_LOGIN_URL = 'https://a-site.example.com/login';

const app = require('../server');
const db = require('../src/db');
const identity = require('../src/identity');

let base, server;
test.before(async () => {
  await new Promise((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
});
test.after(() => server && server.close());

function makeJar() {
  let cookie = '';
  return {
    header: () => (cookie ? { Cookie: cookie } : {}),
    capture(res) {
      const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of sc) {
        const m = c.match(/^connect\.sid=[^;]+/);
        if (m) cookie = m[0];
      }
    },
  };
}
async function get(p, jar) {
  const res = await fetch(base + p, { headers: jar ? jar.header() : {}, redirect: 'manual' });
  if (jar) jar.capture(res);
  return res;
}
// A사이트가 회원을 넘길 때 붙이는 토큰
const token = (claims) => identity.sign({ iat: Math.floor(Date.now() / 1000), ...claims });
const userOf = (uid) => db.prepare('SELECT * FROM users WHERE external_id = ?').get(uid);

test('A사이트 회원이 넘어오면 가입 절차 없이 프로필이 생긴다', async () => {
  const jar = makeJar();
  const res = await get(`/board?sso=${token({ uid: 'A-1001', nick: '알바왕' })}`, jar);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/board', '토큰은 주소에서 떼어낸다');

  const u = userOf('A-1001');
  assert.ok(u, '프로필이 만들어져야 한다');
  assert.equal(u.nickname, '알바왕', 'A사이트 닉네임을 그대로 쓴다');
  assert.equal(u.password_hash, '', '비밀번호는 우리가 갖지 않는다');
  assert.equal(u.points, 1000, '기획서의 가입 1,000P는 첫 방문에 지급한다');

  const html = await (await get('/board', jar)).text();
  assert.ok(html.includes('알바왕'), '이어지는 요청에서 로그인 상태가 유지된다');
});

test('두 번째 방문에는 프로필도 포인트도 새로 생기지 않는다', async () => {
  const before = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  await get(`/board?sso=${token({ uid: 'A-1001', nick: '알바왕' })}`, makeJar());
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM users').get().c, before, '프로필은 하나뿐');
  assert.equal(userOf('A-1001').points, 1000, '첫 방문 포인트는 한 번만');
});

test('닉네임이 이미 쓰이고 있으면 뒤에 숫자를 붙여 만든다', async () => {
  await get(`/board?sso=${token({ uid: 'A-1002', nick: '알바왕' })}`, makeJar());
  const u = userOf('A-1002');
  assert.ok(u && u.nickname !== '알바왕', '겹치면 그대로 쓸 수 없다');
  assert.match(u.nickname, /^알바왕\d+$/);
});

test('닉네임을 안 보내줘도 프로필은 만들어진다', async () => {
  await get(`/board?sso=${token({ uid: 'A-1003' })}`, makeJar());
  const u = userOf('A-1003');
  assert.ok(u && u.nickname.length >= 2, 'A사이트가 닉네임을 안 줘도 동작해야 한다');
});

test('운영자 여부는 A사이트가 정한다', async () => {
  await get(`/board?sso=${token({ uid: 'A-9000', nick: '관리자님', admin: true })}`, makeJar());
  assert.equal(userOf('A-9000').is_admin, 1);
  // 권한이 회수되면 다음 진입 때 따라 내려간다
  await get(`/board?sso=${token({ uid: 'A-9000', admin: false })}`, makeJar());
  assert.equal(userOf('A-9000').is_admin, 0);
});

test('A사이트에서 정지된 회원은 로그인되지 않는다', async () => {
  const jar = makeJar();
  await get(`/board?sso=${token({ uid: 'A-7000', nick: '정지회원', banned: true })}`, jar);
  const html = await (await get('/board', jar)).text();
  assert.ok(!html.includes('정지회원'), '정지 회원으로는 세션이 열리지 않아야 한다');
});

test('위조·만료된 토큰은 통하지 않는다', async () => {
  const cases = [
    ['서명이 틀린 토큰', token({ uid: 'A-666' }).slice(0, -3) + 'AAA'],
    ['서명이 없는 토큰', Buffer.from(JSON.stringify({ uid: 'A-667', iat: 1 })).toString('base64url')],
    ['시간이 지난 토큰', identity.sign({ uid: 'A-668', iat: Math.floor(Date.now() / 1000) - 99999 })],
    ['회원번호가 없는 토큰', token({ nick: '누구' })],
  ];
  for (const [label, bad] of cases) {
    const jar = makeJar();
    const res = await get(`/board?sso=${bad}`, jar);
    assert.equal(res.status, 302, `${label}: 조용히 되돌린다`);
    const html = await (await get('/board', jar)).text();
    assert.ok(html.includes('로그인'), `${label}: 로그인되면 안 된다`);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM users WHERE external_id LIKE 'A-66%'").get().c, 0,
    '위조 토큰으로는 프로필이 만들어지지 않는다');
});

test('연동 모드에서는 자체 회원가입 화면이 열리지 않는다', async () => {
  const res = await get('/signup');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login');

  // 토큰까지 갖춰 제대로 보낸 요청도 막혀야 한다 (CSRF에 걸려서 막히는 것과 구분)
  const jar = makeJar();
  const page = await (await get('/board', jar)).text();
  const csrf = page.match(/name="csrf-token" content="([^"]+)"/)[1];
  const post = await fetch(base + '/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...jar.header() },
    body: new URLSearchParams({ _csrf: csrf, username: 'sneaky', nickname: '몰래', password: 'password123' }).toString(),
    redirect: 'manual',
  });
  assert.equal(post.status, 302, '가입 요청도 막힌다');
  assert.equal(post.headers.get('location'), '/login');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM users WHERE username = ?').get('sneaky').c, 0);
});

test('로그인하러 가면 A사이트 로그인 화면으로 보낸다', async () => {
  const res = await get('/login?next=%2Fpoints');
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get('location'));
  assert.equal(to.origin + to.pathname, 'https://a-site.example.com/login');
  assert.match(to.searchParams.get('returnUrl'), /\/points$/, '돌아올 곳을 함께 알려준다');
});

test('보고 있던 화면으로 그대로 들어온다', async () => {
  const jar = makeJar();
  const res = await get(`/points?sso=${token({ uid: 'A-1500', nick: '경로유지' })}`, jar);
  assert.equal(res.headers.get('location'), '/points', '들어온 화면을 유지한다');
});

// ---- PHP 5.1 로 만든 토큰도 받아들이는지 ---------------------------------------
//
// 연동가이드의 PHP 예제는 json_encode(PHP 5.2+) 를 못 써서 payload 를 문자열로
// 직접 짓는다. 그렇게 만든 것과 우리 sign() 이 만든 것이 같은지 확인한다.
// (한글 닉네임을 이스케이프 없이 UTF-8 그대로 담는 것도 여기서 검증된다)
test('PHP 5.1 방식으로 손수 지은 토큰도 통과한다', () => {
  const crypto = require('crypto');
  const secret = process.env.HOST_SSO_SECRET;

  // 가이드의 sso_str() 과 같은 규칙
  const ssoStr = (v) => '"' + String(v)
    .replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
  const b64url = (buf) => Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const nick = '민트소다';                 // 한글 · 이스케이프 없이 그대로
  const payload = '{'
    + '"uid":' + ssoStr('A-100')
    + ',"nick":' + ssoStr(nick)
    + ',"admin":false'
    + ',"iat":' + Math.floor(Date.now() / 1000)
    + '}';
  const body = b64url(Buffer.from(payload, 'utf8'));
  const sig = b64url(crypto.createHmac('sha256', secret).update(body).digest());

  const got = identity.verify(`${body}.${sig}`);
  assert.ok(got, 'PHP 5.1 방식으로 만든 토큰이 거절됐다');
  assert.equal(got.uid, 'A-100');
  assert.equal(got.nick, nick, '한글 닉네임이 깨졌다');
  assert.equal(got.admin, false);
});

test('따옴표·역슬래시가 든 닉네임도 깨지지 않는다', () => {
  const crypto = require('crypto');
  const secret = process.env.HOST_SSO_SECRET;
  const ssoStr = (v) => '"' + String(v)
    .replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
  const b64url = (buf) => Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const nick = '따"옴\\표';
  const payload = `{"uid":${ssoStr('A-2')},"nick":${ssoStr(nick)},"admin":false,"iat":${Math.floor(Date.now() / 1000)}}`;
  const body = b64url(Buffer.from(payload, 'utf8'));
  const sig = b64url(crypto.createHmac('sha256', secret).update(body).digest());

  const got = identity.verify(`${body}.${sig}`);
  assert.ok(got, '이스케이프가 필요한 닉네임에서 토큰이 깨졌다');
  assert.equal(got.nick, nick);
});
