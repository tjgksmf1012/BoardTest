// 포인트 아바타 커뮤니티 게시판 서버
process.env.TZ = process.env.TZ || 'Asia/Seoul';

const path = require('path');
const express = require('express');
const session = require('express-session');

const db = require('./src/db');
const seed = require('./src/seed');
const { renderAvatar } = require('./src/avatars');
const { unreadCount } = require('./src/notify');
const { router: authRouter } = require('./src/routes/auth');
const boardRouter = require('./src/routes/board');
const userRouter = require('./src/routes/user');

seed(); // 최초 실행 시 데모 데이터 생성

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'boardtest-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 },
}));

// 모든 뷰에서 쓰는 공통 데이터 (로그인 사용자, 아바타 렌더러, 플래시 메시지)
app.use((req, res, next) => {
  res.locals.me = req.session.userId
    ? db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId)
    : null;
  if (req.session.userId && !res.locals.me) req.session.destroy(() => {});
  res.locals.renderAvatar = renderAvatar;
  res.locals.unread = res.locals.me ? unreadCount(res.locals.me.id) : 0;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`게시판 서버 실행 중: http://localhost:${PORT}`);
});
