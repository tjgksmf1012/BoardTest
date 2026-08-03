// 출석체크 / 포인트 내역 / 프로필(아바타 해금·장착)
const express = require('express');
const db = require('../db');
const { RULES, checkAttendance, unlockMessage, nextUnlock, attendanceView,
  currentStreak, streakBeforeToday, checkedToday, recentWeek, nextMilestone,
  MILESTONES, monthlyCount, challengeView, weekChallenge } = require('../points');
const { AVATARS, BORDERS, TIER_INFO, canUseAvatar, canUseBorder, eventOpen } = require('../avatars');
const { getLevel, achievements } = require('../levels');
const { unreadCount } = require('../notify');
const { subscribe } = require('../realtime');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    req.session.flash = '로그인이 필요한 기능이에요.';
    let back = req.method === 'GET' ? req.originalUrl : '';
    if (!back) {
      try { back = new URL(req.get('Referer')).pathname; } catch { back = ''; }
    }
    const q = /^\/[^/]/.test(back) && !back.startsWith('//') ? `?next=${encodeURIComponent(back)}` : '';
    return res.redirect(`/login${q}`);
  }
  next();
}

// ---- 출석체크 --------------------------------------------------------------
// 출석 전용 화면. 접속하자마자 자동으로 처리하지 않고, 직접 버튼을 눌러 출석한다.
// 달력 기록은 그대로 마이페이지 '출석' 탭에서 본다.
router.get('/attendance', requireLogin, (req, res) => {
  const me = res.locals.me;
  const done = checkedToday(me.id);
  // 출석 전이면 '어제까지' 이어온 일수를 보여준다 — 그래야 0일 연속으로 보이지 않는다
  const streak = done ? currentStreak(me.id) : streakBeforeToday(me.id);
  res.render('attendance', {
    done,
    streak,
    monthly: monthlyCount(me.id),
    challenge: challengeView(streak),
    week: weekChallenge(done ? streak : streak + 1),
    next: nextMilestone(streak),
    attendPoint: RULES.attendance.amount,
    milestones: MILESTONES,
  });
});

// 폼에서 넘어온 복귀 주소가 우리 사이트 내부 경로일 때만 사용한다 (오픈 리다이렉트 방지)
function safeNext(value, fallback) {
  return typeof value === 'string' && /^\/[^/]/.test(value) ? value : fallback;
}

router.post('/attendance/check', requireLogin, (req, res) => {
  const userId = req.session.userId;
  const result = checkAttendance(userId);
  const total = result.already ? 0 : result.results.reduce((s, r) => s + r.awarded, 0);
  const streak = result.already ? currentStreak(userId) : result.streak;

  // 출석부 팝업은 화면 전환 없이 도장 찍는 연출을 해야 하므로 JSON으로 결과를 받는다
  if (req.get('Accept') === 'application/json') {
    const points = db.prepare('SELECT points FROM users WHERE id = ?').get(userId).points;
    return res.json({
      already: result.already,
      awarded: total,
      base: result.already ? 0 : RULES.attendance.amount,
      bonus: Math.max(0, total - (result.already ? 0 : RULES.attendance.amount)),
      streak,
      week: recentWeek(userId),
      next: nextMilestone(streak),
      points,
      unlocked: result.already ? [] : result.results.flatMap((r) => r.unlocked || []),
    });
  }

  if (result.already) {
    req.session.flash = '오늘은 이미 출석했어요. 내일 또 만나요!';
  } else {
    const bonus = result.results.length > 1 ? ` (${result.streak}일 연속 출석 보너스 포함!)` : '';
    req.session.flash = `출석 완료! +${total}P 적립됐어요.${bonus}` + unlockMessage(result.results);
  }
  // 마이페이지 출석 탭 등 일반 폼 전송은 기존처럼 화면을 되돌린다
  res.redirect(safeNext(req.body.next, '/attendance'));
});

// ---- 포인트 내역 -------------------------------------------------------------
router.get('/points', requireLogin, (req, res) => {
  const logs = db.prepare(
    'SELECT * FROM point_logs WHERE user_id = ? ORDER BY id DESC LIMIT 100'
  ).all(req.session.userId);
  const todayTotal = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM point_logs
     WHERE user_id = ? AND date(created_at) = date('now', 'localtime')`
  ).get(req.session.userId).s;
  res.render('points', { logs, todayTotal, RULES, milestones: MILESTONES, next: nextUnlock(res.locals.me.points) });
});

// ---- 알림 ------------------------------------------------------------------
router.get('/notifications', requireLogin, (req, res) => {
  const items = db.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50'
  ).all(req.session.userId);
  // 화면에 보여준 알림은 읽음 처리
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0')
    .run(req.session.userId);
  res.render('notifications', { items });
});

// 실시간 알림 (SSE). 브라우저가 이 주소를 열어두면 새 알림이 생길 때 서버가 곧바로 밀어준다.
router.get('/notifications/stream', (req, res) => {
  if (!req.session.userId) return res.status(401).end();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // 중간 서버(nginx 등)가 응답을 모아두지 않게
  });
  res.write('retry: 5000\n\n'); // 끊기면 5초 뒤 다시 붙어라
  res.write(`event: ready\ndata: ${JSON.stringify({ unread: unreadCount(req.session.userId) })}\n\n`);
  subscribe(req.session.userId, res);
});

// 연결을 못 여는 환경(서버리스·구형 브라우저)을 위한 대체 수단
router.get('/notifications/count', requireLogin, (req, res) => {
  res.json({ unread: unreadCount(req.session.userId) });
});

// ---- 신고 관리 (운영자) --------------------------------------------------------
router.get('/reports', requireLogin, (req, res) => {
  if (!res.locals.me.is_admin) return res.redirect('/board');
  const items = db.prepare(`
    SELECT p.id, p.category, p.title, p.is_anonymous, u.nickname,
      COUNT(r.id) AS report_count, MAX(r.created_at) AS last_reported
    FROM reports r
    JOIN posts p ON p.id = r.post_id
    JOIN users u ON u.id = p.user_id
    GROUP BY r.post_id
    ORDER BY report_count DESC, last_reported DESC`).all();

  const commentItems = db.prepare(`
    SELECT c.id, c.content, c.post_id, u.nickname,
      COUNT(cr.id) AS report_count, MAX(cr.created_at) AS last_reported
    FROM comment_reports cr
    JOIN comments c ON c.id = cr.comment_id
    JOIN users u ON u.id = c.user_id
    GROUP BY cr.comment_id
    ORDER BY report_count DESC, last_reported DESC`).all();

  res.render('reports', { items, commentItems });
});

// ---- 회원 관리 (운영자) --------------------------------------------------------
router.get('/admin/members', requireLogin, (req, res) => {
  if (!res.locals.me.is_admin) return res.redirect('/board');
  const members = db.prepare(`
    SELECT u.id, u.username, u.nickname, u.points, u.is_admin, u.is_banned, u.created_at,
      (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id AND p.is_notice = 0) AS post_count,
      (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id) AS comment_count
    FROM users u ORDER BY u.is_banned DESC, u.points DESC`).all();
  res.render('members', { members });
});

router.post('/admin/members/:id(\\d+)/ban', requireLogin, (req, res) => {
  if (!res.locals.me.is_admin) return res.redirect('/board');
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target || target.is_admin || target.id === res.locals.me.id) {
    req.session.flash = '운영자 또는 본인 계정은 제재할 수 없어요.';
  } else {
    const next = target.is_banned ? 0 : 1;
    db.prepare('UPDATE users SET is_banned = ? WHERE id = ?').run(next, target.id);
    req.session.flash = next
      ? `${target.nickname}님을 제재했어요. (로그인·활동 차단)`
      : `${target.nickname}님의 제재를 해제했어요.`;
  }
  res.redirect('/admin/members');
});

// ---- 포인트 랭킹 -------------------------------------------------------------
router.get('/ranking', (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.nickname, u.points, u.avatar_id, u.border_id, u.is_admin,
      (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id AND p.is_notice = 0) AS post_count,
      (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id) AS comment_count
    FROM users u ORDER BY u.points DESC, u.id LIMIT 20`).all();
  res.render('ranking', { users });
});

// ---- 공개 프로필 (다른 사람 프로필 보기) --------------------------------------
// 익명으로 쓴 글은 작성자가 드러나면 안 되므로 목록에서 제외한다.
// 스크랩·알림처럼 남에게 보일 이유가 없는 정보도 넣지 않는다.
router.get('/users/:id(\\d+)', (req, res) => {
  const user = db.prepare(
    'SELECT id, nickname, points, avatar_id, border_id, is_admin, is_banned, created_at FROM users WHERE id = ?'
  ).get(req.params.id);
  if (!user) return res.status(404).render('error', { message: '존재하지 않는 회원이에요.' });

  // 본인이면 마이페이지로 (거기서 더 많은 걸 할 수 있다)
  if (res.locals.me && res.locals.me.id === user.id) return res.redirect('/profile');

  const stats = {
    points: user.points,
    posts: db.prepare(
      'SELECT COUNT(*) AS c FROM posts WHERE user_id = ? AND is_notice = 0 AND is_anonymous = 0 AND is_hidden = 0'
    ).get(user.id).c,
    comments: db.prepare('SELECT COUNT(*) AS c FROM comments WHERE user_id = ?').get(user.id).c,
    likesReceived: db.prepare(
      'SELECT COUNT(*) AS c FROM likes l JOIN posts p ON p.id = l.post_id WHERE p.user_id = ?'
    ).get(user.id).c,
    attendance: db.prepare('SELECT COUNT(*) AS c FROM attendance WHERE user_id = ?').get(user.id).c,
    popularPosts: db.prepare('SELECT COUNT(*) AS c FROM posts WHERE user_id = ? AND is_popular = 1').get(user.id).c,
    adminPicks: db.prepare('SELECT COUNT(*) AS c FROM posts WHERE user_id = ? AND admin_picked = 1').get(user.id).c,
  };

  const posts = db.prepare(`
    SELECT id, title, category, created_at, like_count,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = posts.id) AS comment_count
    FROM posts
    WHERE user_id = ? AND is_notice = 0 AND is_anonymous = 0 AND is_hidden = 0
    ORDER BY id DESC LIMIT 10`).all(user.id);

  const rank = db.prepare(
    'SELECT COUNT(*) + 1 AS r FROM users WHERE points > ? OR (points = ? AND id < ?)'
  ).get(user.points, user.points, user.id).r;

  res.render('user-profile', {
    title: `${user.nickname}님`,
    user, stats, posts, rank,
    level: getLevel(user.points),
    badges: achievements(stats).filter((b) => b.earned),
  });
});

// ---- 프로필 / 아바타 -----------------------------------------------------------
router.get('/profile', requireLogin, (req, res) => {
  const me = res.locals.me;
  const groups = ['basic', 'hair', 'outfit', 'event'].map((tier) => ({
    tier,
    info: TIER_INFO[tier],
    avatars: AVATARS.filter((a) => a.tier === tier).map((a) => ({
      ...a,
      unlocked: canUseAvatar(me, a.id),
      seasonOpen: a.tier !== 'event' || eventOpen(a),
    })),
  }));
  const borders = BORDERS.map((b) => ({ ...b, unlocked: canUseBorder(me, b.id) }));

  const stats = {
    points: me.points,
    posts: db.prepare('SELECT COUNT(*) AS c FROM posts WHERE user_id = ? AND is_notice = 0').get(me.id).c,
    comments: db.prepare('SELECT COUNT(*) AS c FROM comments WHERE user_id = ?').get(me.id).c,
    likesReceived: db.prepare(
      `SELECT COUNT(*) AS c FROM likes l JOIN posts p ON p.id = l.post_id WHERE p.user_id = ?`
    ).get(me.id).c,
    attendance: db.prepare('SELECT COUNT(*) AS c FROM attendance WHERE user_id = ?').get(me.id).c,
    popularPosts: db.prepare('SELECT COUNT(*) AS c FROM posts WHERE user_id = ? AND is_popular = 1').get(me.id).c,
    adminPicks: db.prepare('SELECT COUNT(*) AS c FROM posts WHERE user_id = ? AND admin_picked = 1').get(me.id).c,
  };
  const badges = achievements(stats);

  // 내 활동 모아보기 (최근 5개씩)
  const myPosts = db.prepare(`
    SELECT id, title, is_anonymous, created_at,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = posts.id) AS comment_count
    FROM posts WHERE user_id = ? AND is_notice = 0 ORDER BY id DESC LIMIT 5`).all(me.id);
  const myComments = db.prepare(`
    SELECT c.id, c.content, c.created_at, c.post_id, p.title AS post_title
    FROM comments c JOIN posts p ON p.id = c.post_id
    WHERE c.user_id = ? ORDER BY c.id DESC LIMIT 5`).all(me.id);
  const myBookmarks = db.prepare(`
    SELECT b.post_id, p.title, p.is_anonymous, u.nickname, b.created_at
    FROM bookmarks b JOIN posts p ON p.id = b.post_id JOIN users u ON u.id = p.user_id
    WHERE b.user_id = ? ORDER BY b.id DESC LIMIT 5`).all(me.id);

  res.render('profile', {
    groups, borders, stats, badges, myPosts, myComments, myBookmarks,
    next: nextUnlock(me.points), level: getLevel(me.points),
    att: attendanceView(me.id),
  });
});

router.post('/profile/avatar', requireLogin, (req, res) => {
  const avatarId = req.body.avatar_id;
  if (canUseAvatar(res.locals.me, avatarId)) {
    db.prepare('UPDATE users SET avatar_id = ? WHERE id = ?').run(avatarId, req.session.userId);
    req.session.flash = '아바타를 변경했어요!';
  } else {
    req.session.flash = '아직 해금되지 않은 아바타예요.';
  }
  res.redirect('/profile#avatar');
});

router.post('/profile/border', requireLogin, (req, res) => {
  const borderId = req.body.border_id || null;
  if (!borderId) {
    db.prepare('UPDATE users SET border_id = NULL WHERE id = ?').run(req.session.userId);
    req.session.flash = '테두리를 해제했어요.';
  } else if (canUseBorder(res.locals.me, borderId)) {
    db.prepare('UPDATE users SET border_id = ? WHERE id = ?').run(borderId, req.session.userId);
    req.session.flash = '테두리를 장착했어요!';
  } else {
    req.session.flash = '테두리는 20,000P 부터 해금돼요.';
  }
  res.redirect('/profile#avatar');
});

module.exports = router;
