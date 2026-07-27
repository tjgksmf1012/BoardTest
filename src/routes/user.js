// 출석체크 / 포인트 내역 / 프로필(아바타 해금·장착)
const express = require('express');
const db = require('../db');
const { RULES, checkAttendance, unlockMessage, nextUnlock, attendanceView } = require('../points');
const { AVATARS, BORDERS, TIER_INFO, canUseAvatar, canUseBorder, eventOpen } = require('../avatars');
const { getLevel, achievements } = require('../levels');

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
// 출석은 하루 한 번뿐이라 별도 메뉴 대신 그날 첫 접속 시 안내 팝업으로 처리하고,
// 달력·연속출석 기록은 마이페이지 '출석' 탭에서 본다. (옛 주소는 그쪽으로 넘긴다)
router.get('/attendance', requireLogin, (req, res) => res.redirect('/profile#attendance'));

// 폼에서 넘어온 복귀 주소가 우리 사이트 내부 경로일 때만 사용한다 (오픈 리다이렉트 방지)
function safeNext(value, fallback) {
  return typeof value === 'string' && /^\/[^/]/.test(value) ? value : fallback;
}

router.post('/attendance/check', requireLogin, (req, res) => {
  const result = checkAttendance(req.session.userId);
  if (result.already) {
    req.session.flash = '오늘은 이미 출석했어요. 내일 또 만나요!';
  } else {
    const total = result.results.reduce((s, r) => s + r.awarded, 0);
    const bonus = result.results.length > 1 ? ` (${result.streak}일 연속 출석 보너스 포함!)` : '';
    req.session.flash = `출석 완료! +${total}P 적립됐어요.${bonus}` + unlockMessage(result.results);
  }
  // 팝업에서 출석했으면 보던 화면 그대로, 마이페이지에서 했으면 출석 탭으로 돌아간다
  res.redirect(safeNext(req.body.next, '/profile#attendance'));
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
  res.render('points', { logs, todayTotal, RULES, next: nextUnlock(res.locals.me.points) });
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
