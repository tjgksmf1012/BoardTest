// 출석체크 / 포인트 내역 / 프로필(아바타 해금·장착)
const express = require('express');
const db = require('../db');
const { RULES, checkAttendance, unlockMessage } = require('../points');
const { AVATARS, BORDERS, TIER_INFO, canUseAvatar, canUseBorder, eventOpen } = require('../avatars');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    req.session.flash = '로그인이 필요한 기능이에요.';
    return res.redirect('/login');
  }
  next();
}

// ---- 출석체크 --------------------------------------------------------------
router.get('/attendance', requireLogin, (req, res) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();

  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-%`;
  const checkedDays = new Set(
    db.prepare('SELECT day FROM attendance WHERE user_id = ? AND day LIKE ?')
      .all(req.session.userId, prefix).map((r) => Number(r.day.slice(-2)))
  );

  // 오늘까지의 연속 출석일
  let streak = 0;
  const cursor = new Date();
  const p = (n) => String(n).padStart(2, '0');
  for (;;) {
    const d = `${cursor.getFullYear()}-${p(cursor.getMonth() + 1)}-${p(cursor.getDate())}`;
    if (!db.prepare('SELECT 1 FROM attendance WHERE user_id = ? AND day = ?').get(req.session.userId, d)) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  res.render('attendance', {
    year, month: month + 1, daysInMonth, firstWeekday,
    checkedDays, today: now.getDate(),
    checkedToday: checkedDays.has(now.getDate()),
    streak,
  });
});

router.post('/attendance/check', requireLogin, (req, res) => {
  const result = checkAttendance(req.session.userId);
  if (result.already) {
    req.session.flash = '오늘은 이미 출석했어요. 내일 또 만나요!';
  } else {
    const total = result.results.reduce((s, r) => s + r.awarded, 0);
    const bonus = result.results.length > 1 ? ` (${result.streak}일 연속 출석 보너스 포함!)` : '';
    req.session.flash = `✅ 출석 완료! +${total}P 적립됐어요.${bonus}` + unlockMessage(result.results);
  }
  res.redirect('/attendance');
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
  res.render('points', { logs, todayTotal, RULES });
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
    posts: db.prepare('SELECT COUNT(*) AS c FROM posts WHERE user_id = ?').get(me.id).c,
    comments: db.prepare('SELECT COUNT(*) AS c FROM comments WHERE user_id = ?').get(me.id).c,
    likesReceived: db.prepare(
      `SELECT COUNT(*) AS c FROM likes l JOIN posts p ON p.id = l.post_id WHERE p.user_id = ?`
    ).get(me.id).c,
    attendance: db.prepare('SELECT COUNT(*) AS c FROM attendance WHERE user_id = ?').get(me.id).c,
  };

  res.render('profile', { groups, borders, stats });
});

router.post('/profile/avatar', requireLogin, (req, res) => {
  const avatarId = req.body.avatar_id;
  if (canUseAvatar(res.locals.me, avatarId)) {
    db.prepare('UPDATE users SET avatar_id = ? WHERE id = ?').run(avatarId, req.session.userId);
    req.session.flash = '아바타를 변경했어요!';
  } else {
    req.session.flash = '아직 해금되지 않은 아바타예요.';
  }
  res.redirect('/profile');
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
  res.redirect('/profile');
});

module.exports = router;
