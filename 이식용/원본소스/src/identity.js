// 신원(누가 로그인했는가)을 어디서 가져올지 고르는 어댑터
//
// 이 커뮤니티는 이미 회원을 가진 알바채용 사이트(기획서의 'A사이트') 안에 들어간다.
// 그러니 아이디·비밀번호의 원장은 A사이트이고, 우리는 그 회원번호에 매달린
// '커뮤니티 프로필'(포인트·아바타·활동)만 가진다. 같은 사람에게 계정을 두 번
// 만들게 하면 탈퇴·정지·비밀번호 변경이 두 곳에서 따로 놀고,
// 보관할 이유가 없는 비밀번호를 한 벌 더 떠안게 된다.
//
//   AUTH_MODE=standalone  자체 아이디/비밀번호 — 혼자 띄워서 보여줄 때 (기본값)
//   AUTH_MODE=host        A사이트가 넘겨준 회원번호를 믿는다 — 실제로 삽입할 때
//
// host 모드에서 A사이트가 우리에게 보내야 하는 것은 서명된 토큰 하나뿐이다.
// (자세한 규격과 요청할 항목은 docs/연동가이드.md 참고)
const crypto = require('crypto');
const db = require('./db');

const MODE = process.env.AUTH_MODE === 'host' ? 'host' : 'standalone';
const SECRET = process.env.HOST_SSO_SECRET || '';
const TTL_SEC = Number(process.env.HOST_SSO_TTL_SEC) || 300; // 새어나간 주소가 오래 살아있지 않게
const LOGIN_URL = process.env.HOST_LOGIN_URL || '';
const LOGOUT_URL = process.env.HOST_LOGOUT_URL || '';

const isHost = () => MODE === 'host';
const isStandalone = () => MODE === 'standalone';

// ---- 토큰 ------------------------------------------------------------------
// 형식: base64url(JSON) + '.' + base64url(HMAC-SHA256)
// A사이트는 로그인한 회원을 커뮤니티로 보낼 때 이 토큰을 ?sso= 로 붙여준다.
const b64 = (buf) => Buffer.from(buf).toString('base64url');

function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

// 서명이 맞고 시간이 지나지 않은 토큰만 통과시킨다. 실패 이유는 밖으로 알리지 않는다.
function verify(token) {
  if (!SECRET || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let data;
  try { data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!data || typeof data.uid !== 'string' || !data.uid.trim()) return null;
  const iat = Number(data.iat);
  if (!Number.isFinite(iat)) return null;
  const age = Math.floor(Date.now() / 1000) - iat;
  if (age > TTL_SEC || age < -60) return null; // 미래에서 온 토큰도 거른다(시계 오차 60초는 봐줌)
  return data;
}

// ---- 프로필 ----------------------------------------------------------------
// 커뮤니티 닉네임은 UNIQUE라, A사이트 닉네임이 이미 쓰이고 있으면 뒤에 숫자를 붙인다.
function freeNickname(want) {
  const base = (want || '').trim().slice(0, 10) || '회원';
  const taken = (n) => db.prepare('SELECT 1 FROM users WHERE nickname = ?').get(n);
  if (!taken(base)) return base;
  for (let i = 2; i <= 99; i++) {
    const n = `${base.slice(0, 8)}${i}`;
    if (!taken(n)) return n;
  }
  return `회원${crypto.randomBytes(3).toString('hex')}`;
}

// A사이트 회원번호로 커뮤니티 프로필을 찾고, 없으면 그 자리에서 만든다.
// '가입' 절차가 따로 없다 — A사이트 회원이면 커뮤니티 회원이다.
function ensureProfile(claims) {
  const externalId = String(claims.uid).trim();
  let user = db.prepare('SELECT * FROM users WHERE external_id = ?').get(externalId);
  let created = false;

  if (!user) {
    // 비밀번호는 우리가 갖지 않는다. 빈 해시는 로그인 검증에서 항상 막힌다.
    const info = db.prepare(
      `INSERT INTO users (username, password_hash, nickname, external_id, is_admin, is_banned)
       VALUES (?, '', ?, ?, ?, ?)`
    ).run(`host:${externalId}`, freeNickname(claims.nick), externalId,
      claims.admin ? 1 : 0, claims.banned ? 1 : 0); // 정지 상태로 처음 넘어올 수도 있다
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    created = true;
  } else {
    // 권한·정지 여부의 원장은 A사이트다. 값을 보내온 경우에만 맞춘다.
    if (typeof claims.admin === 'boolean' && Number(claims.admin) !== user.is_admin) {
      db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(claims.admin ? 1 : 0, user.id);
      user.is_admin = claims.admin ? 1 : 0;
    }
    if (typeof claims.banned === 'boolean' && Number(claims.banned) !== user.is_banned) {
      db.prepare('UPDATE users SET is_banned = ? WHERE id = ?').run(claims.banned ? 1 : 0, user.id);
      user.is_banned = claims.banned ? 1 : 0;
    }
  }
  return { user, created };
}

module.exports = {
  MODE, isHost, isStandalone,
  LOGIN_URL, LOGOUT_URL, TTL_SEC,
  sign, verify, ensureProfile, freeNickname,
  hasSecret: () => !!SECRET,
  // 연동가이드에 '32자 이상' 이라고 적어 두었는데 아무도 확인하지 않고 있었다.
  // 짧은 키는 없는 키보다 위험하다 — 없으면 아무도 못 들어오지만,
  // 짧으면 남이 맞혀서 아무 회원으로나 들어올 수 있고 화면은 멀쩡해 보인다.
  SECRET_MIN: 32,
  secretTooShort: () => !!SECRET && SECRET.length < 32,
};
