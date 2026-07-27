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
const { checkedToday, streakBeforeToday, todayStr, recentWeek } = require('./src/points');
const { levelBadge, getLevel } = require('./src/levels');
const { catTag } = require('./src/categories');
const { icon } = require('./src/icons');
const { router: authRouter } = require('./src/routes/auth');
const boardRouter = require('./src/routes/board');
const userRouter = require('./src/routes/user');

seed(); // 최초 실행 시 데모 데이터 생성
startUploadsGc(); // 어느 글에도 속하지 않는 오래된 업로드 파일을 주기적으로 정리

// 목록에 쓰는 상대 시간 ("3시간 전"). 일주일이 지나면 날짜로 표시
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr.replace(' ', 'T')).getTime();
  const diff = (Date.now() - then) / 1000;
  if (diff < 0) return dateStr.slice(0, 10);
  if (diff < 60) return '방금 전';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
  return dateStr.slice(0, 10);
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
  app.use(session({
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
  res.locals.unread = res.locals.me ? unreadCount(res.locals.me.id) : 0;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;

  // 오늘 아직 출석 전이면 그날 첫 화면에 출석부를 띄운다 (하루 한 번, 묻지 않고 바로 도장)
  res.locals.attendanceDue = res.locals.me ? !checkedToday(res.locals.me.id) : false;
  res.locals.attendanceStreak = res.locals.attendanceDue ? streakBeforeToday(res.locals.me.id) : 0;
  res.locals.attendanceWeek = res.locals.attendanceDue ? recentWeek(res.locals.me.id) : [];
  res.locals.todayKey = todayStr();
  res.locals.currentPath = req.path; // 출석 후 보던 화면으로 돌아가기 위한 경로

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
