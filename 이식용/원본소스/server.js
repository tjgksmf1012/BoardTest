// 포인트 아바타 커뮤니티 게시판 서버
process.env.TZ = process.env.TZ || 'Asia/Seoul';

const path = require('path');
const express = require('express');
const session = require('express-session');

const db = require('./src/db');
const seed = require('./src/seed');
const { renderAvatar } = require('./src/avatars');
const { unreadCount } = require('./src/notify');
const { startUploadsGc } = require('./src/uploads-gc');
const { rebuildMissing } = require('./src/search');
const { csrfToken, csrfVerify } = require('./src/csrf');
const { award, checkedToday } = require('./src/points');
const identity = require('./src/identity');
const { levelBadge, getLevel } = require('./src/levels');
const { catTag } = require('./src/categories');
const { icon } = require('./src/icons');
const { router: authRouter } = require('./src/routes/auth');
const boardRouter = require('./src/routes/board');
const userRouter = require('./src/routes/user');

seed(); // 최초 실행 시 데모 데이터 생성
startUploadsGc(); // 어느 글에도 속하지 않는 오래된 업로드 파일을 주기적으로 정리

// 스타일 파일 주소 뒤에 붙일 버전. 배포로 파일이 바뀌면 값도 바뀌어
// 브라우저가 예전에 받아둔 스타일을 계속 쓰는 일이 없다.
const ASSET_VERSION = (() => {
  try {
    const st = require('fs').statSync(path.join(__dirname, 'public', 'css', 'style.css'));
    return String(Math.floor(st.mtimeMs)).slice(-8);
  } catch { return '1'; }
})();

// 아직 검색 색인이 없는 글을 채운다 (기존 DB에서 올라온 경우·데모 데이터)
{
  const n = rebuildMissing();
  if (n > 0) console.log(`검색 색인을 ${n}건 새로 만들었어요.`);
}

// 작성 시각 표기 — 하루가 지나기 전에는 시각(24시간제), 지나면 날짜만.
// "3시간 전" 같은 상대 표기는 몇 시에 쓴 글인지 알 수 없어서 실제 시각을 보여준다.
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr.replace(' ', 'T')).getTime();
  if (Number.isNaN(then)) return dateStr.slice(0, 10);
  const diff = (Date.now() - then) / 1000;
  if (diff >= 0 && diff < 86400) return dateStr.slice(11, 16); // HH:MM
  return dateStr.slice(0, 10);                                  // YYYY-MM-DD
}

// 포인트 증감 표기. 캐릭터를 사면 음수가 들어오는데, 화면에서 '+' 를 앞에 붙이고
// 있어서 "+-20,000P" 처럼 부호가 두 개 찍혔다. 부호는 여기서 한 번만 붙인다.
// 빼기 기호는 하이픈(-)이 아니라 −(U+2212)를 쓴다 — 숫자 옆에서 훨씬 잘 보인다.
function signedPoints(amount) {
  const n = Number(amount) || 0;
  return (n < 0 ? '−' : '+') + Math.abs(n).toLocaleString() + 'P';
}

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by'); // 서버 스택 노출 방지
app.set('trust proxy', 1);   // 배포 시 프록시(HTTPS 종단) 뒤에서 secure 쿠키 인식

const isProd = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET || 'boardtest-dev-secret';
if (isProd && SESSION_SECRET === 'boardtest-dev-secret') {
  console.warn('⚠ SESSION_SECRET 환경변수를 설정하세요 (기본값은 안전하지 않습니다).');
}

// 기본 보안 헤더
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// 업로드 폴더: 기본은 프로젝트 내 uploads, 읽기전용 서버리스(Vercel)에서는 /tmp 사용
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
app.use('/uploads', express.static(UPLOAD_DIR));

// 세션: 일반 서버(컨테이너·로컬)는 express-session,
// 파일시스템·메모리가 요청마다 초기화되는 서버리스(Vercel)에서는 쿠키 기반 세션을 써서
// 여러 인스턴스·콜드스타트에도 로그인이 유지되게 한다.
if (process.env.VERCEL) {
  const cookieSession = require('cookie-session');
  const base = cookieSession({
    name: 'sess',
    secret: SESSION_SECRET,
    maxAge: 1000 * 60 * 60 * 24 * 7,
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
  });
  // express-session API(destroy/regenerate) 호환 shim — 쿠키 세션엔 없어서 얹어준다
  app.use((req, res, next) => base(req, res, () => {
    if (req.session && typeof req.session.destroy !== 'function') {
      Object.defineProperty(req.session, 'destroy', {
        value: (cb) => { req.session = null; if (cb) cb(); }, enumerable: false,
      });
      Object.defineProperty(req.session, 'regenerate', {
        value: (cb) => { if (cb) cb(); }, enumerable: false,
      });
    }
    next();
  }));
} else {
  // 세션은 SQLite 에 담는다. 기본값(메모리)으로 두면 배포할 때마다·서버가 쉬었다
  // 깨어날 때마다 모두 로그아웃되고, 만료된 세션이 메모리에 쌓인다. (src/session-store.js)
  const { SqliteStore } = require('./src/session-store');
  const store = new SqliteStore();
  store.startGc();
  app.use(session({
    store,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7,
      httpOnly: true,           // JS에서 쿠키 접근 차단(XSS 완화)
      sameSite: 'lax',          // 타 사이트발 요청에 쿠키 미전송(CSRF 완화)
      secure: isProd ? 'auto' : false, // HTTPS 요청일 때만 secure (프록시 뒤 HTTP도 안전하게 동작)
    },
  }));
}

// A사이트에서 넘어온 회원 받기 (연동 모드에서만)
//
// A사이트가 로그인한 회원을 커뮤니티로 보낼 때 서명된 토큰을 ?sso=... 로 붙인다.
// 여기서 한 번 확인하고 세션을 연 뒤, 토큰은 주소에서 떼어내고 같은 곳으로 다시 보낸다.
// (주소창·방문기록·Referer에 토큰이 남지 않게)
if (identity.isHost()) {
  if (!identity.hasSecret()) {
    console.warn('⚠ AUTH_MODE=host 인데 HOST_SSO_SECRET이 없습니다. 아무도 로그인할 수 없어요.');
  }
  app.use((req, res, next) => {
    if (!req.query.sso) return next();
    const url = new URL(req.originalUrl, 'http://placeholder');
    url.searchParams.delete('sso');
    const clean = url.pathname + url.search;

    const claims = identity.verify(req.query.sso);
    if (!claims) return res.redirect(clean); // 위조·만료된 토큰은 조용히 무시한다

    const { user, created } = identity.ensureProfile(claims);
    if (user.is_banned) return res.redirect(clean);

    // 세션 고정 방어: 로그인 시점에 세션 ID를 새로 발급한다
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      if (created) {
        // 기획서의 '회원가입 1,000P'에 해당한다. 커뮤니티에는 가입 절차가 없으므로 첫 방문에 준다.
        award(user.id, 'signup');
        req.session.flash = '커뮤니티에 오신 걸 환영해요! 첫 방문 포인트 +1,000P를 받았어요.';
      }
      res.redirect(clean);
    });
  });
}

// CSRF 토큰 발급 (어느 화면에서든 폼에 넣을 수 있도록 가장 먼저)
app.use(csrfToken());

// 모든 뷰에서 쓰는 공통 데이터 (로그인 사용자, 아바타 렌더러, 플래시 메시지)
app.use((req, res, next) => {
  res.locals.me = req.session.userId
    ? db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId)
    : null;
  if (req.session.userId && !res.locals.me) req.session.destroy(() => {});
  res.locals.renderAvatar = renderAvatar;
  res.locals.levelBadge = levelBadge;
  res.locals.getLevel = getLevel;
  res.locals.catTag = catTag;
  res.locals.icon = icon;
  res.locals.timeAgo = timeAgo;
  res.locals.signedPoints = signedPoints;
  res.locals.unread = res.locals.me ? unreadCount(res.locals.me.id) : 0;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;

  // 출석은 전용 화면에서 버튼으로 한다. 아직 안 했으면 메뉴에 점을 찍어 알려준다.
  res.locals.attendanceDue = res.locals.me ? !checkedToday(res.locals.me.id) : false;
  res.locals.currentPath = req.path; // 출석 후 보던 화면으로 돌아가기 위한 경로
  res.locals.authMode = identity.MODE;  // 'standalone' | 'host' — 화면의 로그인 안내가 달라진다
  res.locals.assetVersion = ASSET_VERSION;
  // 공유 미리보기(og:)에 쓸 절대 주소. 배포 주소가 있으면 그걸 쓰고, 없으면 요청 정보로 만든다.
  res.locals.siteUrl = (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

  // 제재된 회원은 즉시 로그아웃 처리
  if (res.locals.me && res.locals.me.is_banned) {
    return req.session.destroy(() => {
      res.locals.me = null;
      res.locals.unread = 0;
      res.locals.flash = null;
      res.status(403).render('error', { message: '이용이 제한된 계정이에요. 운영자에게 문의해주세요.' });
    });
  }
  next();
});

// CSRF 검증. 막힐 때 보여줄 오류 화면도 상단바를 그리므로 공통 데이터 설정 뒤에 둔다.
app.use(csrfVerify());

app.use('/', authRouter);
app.use('/board', boardRouter);
app.use('/', userRouter);

app.get('/', (req, res) => res.redirect('/board'));

app.use((req, res) => res.status(404).render('error', { message: '페이지를 찾을 수 없어요.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { message: '문제가 발생했어요. 잠시 후 다시 시도해주세요.' });
});

// 직접 실행할 때만 서버를 띄운다 (통합 테스트에서는 app만 가져다 쓴다)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`게시판 서버 실행 중: http://localhost:${PORT}`);
  });
}

module.exports = app;
