// 출석체크 / 포인트 내역 / 프로필(아바타 해금·장착)
const express = require('express');
const db = require('../db');
const { RULES, checkAttendance, unlockMessage, nextUnlock, attendanceView,
  currentStreak, streakBeforeToday, checkedToday, recentWeek, nextMilestone,
  MILESTONES, monthlyCount, challengeView, weekChallenge } = require('../points');
const avatars = require('../avatars');
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
  // '오늘 적립' 은 말 그대로 오늘 번 것만 센다.
  // 예전에는 그날 기록을 통째로 더해서, 캐릭터를 하나 사면 그날 적립이 음수로 찍혔다
  // ("오늘 적립 −21,990P"). 쓴 돈은 아래 내역에서 따로 보인다.
  const todayTotal = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM point_logs
     WHERE user_id = ? AND amount > 0 AND date(created_at) = date('now', 'localtime')`
  ).get(req.session.userId).s;
  // 시안의 '이벤트·포인트게시판'. 회원이 글을 쓰는 게시판을 따로 파지 않고,
  // 이벤트 말머리가 붙은 글을 여기에 모아 포인트 안내와 함께 보여준다.
  const events = db.prepare(`
    SELECT p.id, p.title, p.created_at, p.views, u.nickname,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count
    FROM posts p JOIN users u ON u.id = p.user_id
    WHERE p.category = '이벤트' AND p.is_hidden = 0
    ORDER BY p.id DESC LIMIT 10`).all();
  res.render('points', { logs, todayTotal, RULES, milestones: MILESTONES,
    next: nextUnlock(res.locals.me.points), events });
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

/* 랭킹에 들어가는 사람의 조건.
 *
 * 랭킹은 여성회원끼리만 겨룬다 (선배님 요청).
 * 남성·업소 회원과 운영자는 성격이 달라서 같이 줄 세우면 뜻이 없다. 제재된 회원도 뺀다.
 *
 * 조건을 한 곳에만 둔다. 목록에서만 빼고 프로필의 '랭킹 N위' 는 그대로 두면
 * 랭킹 1위인 사람 프로필에 '2위' 라고 적히고, 랭킹에 없는 사람한테도 순위가 찍힌다.
 * 실제로 그랬다 — 목록 1위 골드웨이브의 프로필이 2위였다 (운영자를 세고 있었다).
 */
const RANK_WHERE = "u.is_admin = 0 AND u.is_banned = 0 AND u.member_type = 'female'";
const inRanking = (u) => !u.is_admin && !u.is_banned && u.member_type === 'female';

// ---- 포인트 랭킹 -------------------------------------------------------------
router.get('/ranking', (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.nickname, u.points, u.avatar_id, u.border_id, u.is_admin,
      (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id AND p.is_notice = 0) AS post_count,
      (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id) AS comment_count
    FROM users u
    WHERE ${RANK_WHERE}
    ORDER BY u.points DESC, u.id LIMIT 20`).all();
  res.render('ranking', { users });
});

// ---- 공개 프로필 (다른 사람 프로필 보기) --------------------------------------
// 익명으로 쓴 글은 작성자가 드러나면 안 되므로 목록에서 제외한다.
// 스크랩·알림처럼 남에게 보일 이유가 없는 정보도 넣지 않는다.
router.get('/users/:id(\\d+)', (req, res) => {
  const user = db.prepare(
    'SELECT id, nickname, points, avatar_id, border_id, is_admin, is_banned, member_type, created_at FROM users WHERE id = ?'
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

  // 랭킹에 안 들어가는 사람에게는 순위를 안 보여 준다 (목록에 없는데 등수만 있으면 이상하다).
  // 순위를 셀 때도 랭킹에 들어가는 사람만 센다.
  const rank = inRanking(user)
    ? db.prepare(
      `SELECT COUNT(*) + 1 AS r FROM users u
        WHERE ${RANK_WHERE} AND (u.points > ? OR (u.points = ? AND u.id < ?))`
    ).get(user.points, user.points, user.id).r
    : null;

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
  const owned = ownedCodes(me.id);
  const decorate = (list) => list.map((i) => ({
    ...i,
    unlocked: avatars.canUse(me, i.code, owned),
    owned: owned.has(i.code),
  }));
  // 내 유형의 캐릭터만 보여준다 (남성회원에게 여성 캐릭터를 팔 이유가 없다)
  //
  // 여성회원 캐릭터는 225종이라 한 화면에 다 깔면 못 쓴다.
  // 기획서대로 2단계로 나눈다: 1차 = 기본 캐릭터(테마) 9종, 2차 = 그 안의 25종.
  // 낱장으로 온 남성·업소회원은 테마가 없어 1차가 곧 캐릭터 목록이 된다.
  const myThemes = avatars.themes(me.member_type).map((t) => ({
    ...t,
    ...(t.single ? decorate([t.cover])[0] : {}),
    have: t.items.filter((i) => avatars.canUse(me, i.code, owned)).length,
    total: t.items.length,
    using: t.items.some((i) => i.code === me.avatar_id),
  }));
  const openTheme = req.query.theme ? avatars.theme(me.member_type, String(req.query.theme)) : null;

  // 2차 화면. 시안의 칩(전체·헤어·의상·인기·보유중)으로 걸러 본다.
  // 25칸이라 한 화면에 들어가지만, 고르는 사람에게는 묶어 보는 편이 훨씬 편하다.
  const SHOP_FILTERS = ['all', 'hair', 'outfit', 'popular', 'owned'];
  const filter = SHOP_FILTERS.includes(String(req.query.f)) ? String(req.query.f) : 'all';
  let themeItems = null;
  let shopGroups = null;
  let picked = null;
  let themeHave = 0;
  if (openTheme && !openTheme.single) {
    // '인기'는 실제로 많이 산 순서다 (한 번에 세어 두고 메모리에서 붙인다)
    const bought = new Map(db.prepare(
      'SELECT item_code, COUNT(*) AS c FROM user_items GROUP BY item_code'
    ).all().map((r) => [r.item_code, r.c]));
    themeItems = decorate(openTheme.items).map((i) => ({
      ...i,
      no: (i.row - 1) * 5 + i.col,          // 시안의 01~25 번호
      bought: bought.get(i.code) || 0,
    }));

    themeHave = themeItems.filter((i) => i.unlocked).length;

    if (filter === 'hair' || filter === 'outfit') {
      const key = filter === 'hair' ? 'row' : 'col';
      const label = filter === 'hair' ? '헤어' : '의상';
      shopGroups = [1, 2, 3, 4, 5]
        .map((n) => ({ label: `${label} ${n}`, items: themeItems.filter((i) => i[key] === n) }))
        .filter((g) => g.items.length > 0);
    } else if (filter === 'popular') {
      themeItems = [...themeItems].sort((a, b) => b.bought - a.bought || a.no - b.no);
    } else if (filter === 'owned') {
      themeItems = themeItems.filter((i) => i.unlocked);
    }

    // 화면 아래 선택 바에 띄울 스타일. 안 골랐으면 지금 쓰고 있는 것을 보여준다.
    const all = decorate(openTheme.items).map((i) => ({ ...i, no: (i.row - 1) * 5 + i.col }));
    // 시안처럼 늘 하나가 골라져 있게 한다 — 고른 것 → 쓰고 있는 것 → 첫 번째 순
    picked = all.find((i) => i.code === req.query.style)
      || all.find((i) => i.code === me.avatar_id) || all[0] || null;
  }
  const myBorders = decorate(avatars.borders());

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
    myThemes, openTheme, themeItems, shopGroups, picked, shopFilter: filter, themeHave,
    myBorders, memberTypes: avatars.MEMBER_TYPES,
    characterPrice: avatars.CHARACTER_PRICE,
    // 자바스크립트가 꺼져 있어도 링크만으로 원하는 칸이 열리게 서버에서 정해 준다
    tab: ['info', 'attendance', 'avatar'].includes(String(req.query.tab)) ? String(req.query.tab)
      : (req.query.theme ? 'avatar' : 'info'),
    stats, badges, myPosts, myComments, myBookmarks,
    next: nextUnlock(me.points), level: getLevel(me.points),
    att: attendanceView(me.id), milestones: MILESTONES, attendPoint: RULES.attendance.amount,
  });
});

// 그 사람이 산 항목들
function ownedCodes(userId) {
  return new Set(db.prepare('SELECT item_code FROM user_items WHERE user_id = ?')
    .all(userId).map((r) => r.item_code));
}

// 포인트로 구매. 차감과 지급을 한 트랜잭션으로 묶어, 중간에 끊겨도
// '포인트만 빠지고 못 받는' 상태가 남지 않게 한다.
const buyItem = db.transaction((userId, item) => {
  const u = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
  if (u.points < item.price) return { ok: false, reason: 'points' };
  db.prepare('UPDATE users SET points = points - ? WHERE id = ?').run(item.price, userId);
  db.prepare('INSERT INTO user_items (user_id, item_code, price) VALUES (?, ?, ?)')
    .run(userId, item.code, item.price);
  db.prepare("INSERT INTO point_logs (user_id, amount, reason, detail) VALUES (?, ?, 'purchase', ?)")
    .run(userId, -item.price, `${item.name} 구매`);
  return { ok: true };
});

// 사고 나서 목록 맨 위로 튕기면 방금 산 걸 다시 찾아야 한다.
// 보던 캐릭터의 스타일 목록으로 그대로 돌려보낸다.
function backToShop(req, style) {
  const q = new URLSearchParams({ tab: 'avatar' });
  if (req.body.theme) q.set('theme', String(req.body.theme));
  if (req.body.f && req.body.f !== 'all') q.set('f', String(req.body.f));
  if (style) q.set('style', style);
  return `/profile?${q}#avatar`;
}

router.post('/profile/buy', requireLogin, (req, res) => {
  const me = res.locals.me;
  const item = avatars.get(req.body.code);
  const owned = ownedCodes(me.id);
  if (!item || item.price === 0) {
    req.session.flash = '살 수 없는 항목이에요.';
  } else if (owned.has(item.code)) {
    req.session.flash = '이미 가지고 있어요.';
  } else if (item.kind === 'character' && item.memberType !== me.member_type) {
    req.session.flash = '회원 유형에 맞지 않는 캐릭터예요.';
  } else {
    const r = buyItem(me.id, item);
    if (r.ok && item.kind === 'character') {
      // 시안의 '구매 후 즉시 적용'. 사고 나서 한 번 더 눌러야 바뀌면 산 보람이 없다.
      db.prepare('UPDATE users SET avatar_id = ? WHERE id = ?').run(item.code, me.id);
    }
    req.session.flash = r.ok
      ? `${item.name}을(를) 구매하고 바로 장착했어요! (-${item.price.toLocaleString()}P)`
      : `포인트가 부족해요. (${item.price.toLocaleString()}P 필요)`;
  }
  res.redirect(backToShop(req, item && item.code));
});

router.post('/profile/avatar', requireLogin, (req, res) => {
  const code = req.body.avatar_id;
  if (avatars.canUse(res.locals.me, code, ownedCodes(req.session.userId))) {
    db.prepare('UPDATE users SET avatar_id = ? WHERE id = ?').run(code, req.session.userId);
    req.session.flash = '캐릭터를 변경했어요!';
  } else {
    req.session.flash = '아직 가지고 있지 않은 캐릭터예요.';
  }
  res.redirect(backToShop(req, code));
});

router.post('/profile/border', requireLogin, (req, res) => {
  const borderId = req.body.border_id || null;
  if (!borderId) {
    db.prepare('UPDATE users SET border_id = NULL WHERE id = ?').run(req.session.userId);
    req.session.flash = '테두리를 해제했어요.';
  } else if (avatars.canUse(res.locals.me, borderId, ownedCodes(req.session.userId))) {
    db.prepare('UPDATE users SET border_id = ? WHERE id = ?').run(borderId, req.session.userId);
    req.session.flash = '테두리를 장착했어요!';
  } else {
    req.session.flash = `테두리는 ${avatars.BORDER_PRICE.toLocaleString()}P에 구매할 수 있어요.`;
  }
  res.redirect(backToShop(req));
});

module.exports = router;
