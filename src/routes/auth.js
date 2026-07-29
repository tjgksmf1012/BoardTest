// 회원가입 / 로그인 / 로그아웃
//
// A사이트에 붙는 연동(host) 모드에서는 이 화면들이 필요 없다.
// 이미 A사이트 회원인 사람에게 계정을 한 번 더 만들게 할 이유가 없기 때문이다.
// (신원을 어디서 가져오는지는 src/identity.js)
const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const { award } = require('../points');
const identity = require('../identity');

const router = express.Router();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  // 연동 모드로 만들어진 프로필은 비밀번호를 갖지 않는다(빈 해시). 항상 막는다.
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

// 연동 모드에서 자체 가입·로그인 경로를 닫는다
function standaloneOnly(req, res, next) {
  if (identity.isStandalone()) return next();
  return res.redirect('/login');
}

router.get('/signup', standaloneOnly, (req, res) => {
  if (req.session.userId) return res.redirect('/board');
  res.render('signup', { error: null, form: {} });
});

router.post('/signup', standaloneOnly, (req, res) => {
  const username = (req.body.username || '').trim();
  const nickname = (req.body.nickname || '').trim();
  const password = req.body.password || '';
  const form = { username, nickname };

  if (!/^[a-zA-Z0-9_]{4,20}$/.test(username)) {
    return res.render('signup', { error: '아이디는 영문/숫자 4~20자로 입력해주세요.', form });
  }
  if (nickname.length < 2 || nickname.length > 10) {
    return res.render('signup', { error: '닉네임은 2~10자로 입력해주세요.', form });
  }
  if (password.length < 8) {
    return res.render('signup', { error: '비밀번호는 8자 이상으로 입력해주세요.', form });
  }
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    return res.render('signup', { error: '이미 사용 중인 아이디예요.', form });
  }
  if (db.prepare('SELECT 1 FROM users WHERE nickname = ?').get(nickname)) {
    return res.render('signup', { error: '이미 사용 중인 닉네임이에요.', form });
  }

  const info = db.prepare(
    'INSERT INTO users (username, password_hash, nickname) VALUES (?, ?, ?)'
  ).run(username, hashPassword(password), nickname);

  award(info.lastInsertRowid, 'signup'); // 회원가입 최초 1회 1,000P
  startSession(req, info.lastInsertRowid, (err) => {
    if (err) return res.render('signup', { error: '가입 처리 중 문제가 생겼어요. 다시 시도해주세요.', form });
    req.session.flash = '가입을 환영해요! 회원가입 포인트 +1,000P를 받았어요.';
    res.redirect('/board');
  });
});

// 로그인·가입 시 세션 ID를 새로 발급한다.
// 그대로 두면 공격자가 미리 심어둔 세션 ID로 로그인 상태를 가로챌 수 있다(세션 고정).
function startSession(req, userId, done) {
  req.session.regenerate((err) => {
    if (err) return done(err);
    req.session.userId = userId;
    done();
  });
}

// 열린 리다이렉트 방지: 같은 사이트 내부 경로만 허용
function safeNext(next) {
  return typeof next === 'string' && /^\/[^/]/.test(next) && !next.startsWith('//') ? next : '/board';
}

// 무차별 대입 완화: IP당 10분간 실패 10회를 넘으면 잠시 차단 (성공 시 초기화)
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS = 10;
const attempts = new Map(); // ip -> { count, first }

function throttleKey(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}
function isBlocked(key) {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW_MS) { attempts.delete(key); return false; }
  return a.count >= MAX_FAILS;
}
function recordFail(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW_MS) attempts.set(key, { count: 1, first: Date.now() });
  else a.count += 1;
}

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/board');
  // 연동 모드에서는 A사이트 로그인 화면으로 넘긴다. 돌아올 곳도 함께 알려준다.
  if (identity.isHost()) {
    const back = res.locals.siteUrl + safeNext(req.query.next);
    if (!identity.LOGIN_URL) {
      return res.status(500).render('error', { message: '로그인 주소가 설정되지 않았어요. 운영자에게 문의해주세요.' });
    }
    const url = new URL(identity.LOGIN_URL);
    url.searchParams.set('returnUrl', back);
    return res.redirect(url.toString());
  }
  res.render('login', { error: null, form: {}, next: safeNext(req.query.next) });
});

router.post('/login', standaloneOnly, (req, res) => {
  const username = (req.body.username || '').trim();
  const next = safeNext(req.body.next);
  const key = throttleKey(req);

  if (isBlocked(key)) {
    return res.render('login', {
      error: '로그인 시도가 너무 많아요. 잠시 후 다시 시도해주세요.', form: { username }, next,
    });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(req.body.password || '', user.password_hash)) {
    recordFail(key);
    return res.render('login', { error: '아이디 또는 비밀번호가 올바르지 않아요.', form: { username }, next });
  }
  if (user.is_banned) {
    return res.render('login', { error: '이용이 제한된 계정이에요. 운영자에게 문의해주세요.', form: { username }, next });
  }
  attempts.delete(key); // 성공 시 초기화
  startSession(req, user.id, (err) => {
    if (err) {
      return res.render('login', { error: '로그인 처리 중 문제가 생겼어요. 다시 시도해주세요.', form: { username }, next });
    }
    res.redirect(next);
  });
});

router.post('/logout', (req, res) => {
  // 연동 모드에서 커뮤니티만 로그아웃하면 A사이트에는 그대로 로그인돼 있어 헷갈린다.
  // A사이트가 로그아웃 주소를 알려준 경우 그쪽까지 보낸다.
  const to = identity.isHost() && identity.LOGOUT_URL ? identity.LOGOUT_URL : '/board';
  req.session.destroy(() => res.redirect(to));
});

module.exports = { router, hashPassword };
