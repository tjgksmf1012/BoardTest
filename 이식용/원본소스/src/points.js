// 포인트 적립 규칙 (기획안의 "커뮤니티 포인트 제도" 그대로 구현)
const db = require('./db');

const RULES = {
  signup:        { amount: 1000, label: '회원가입' },
  attendance:    { amount: 10,   label: '출석체크' },
  post:          { amount: 300,  label: '일반 게시글 작성', dailyLimit: 3 },
  anon_post:     { amount: 100,  label: '익명 게시글 작성', dailyLimit: 3 },
  comment:       { amount: 100,  label: '댓글·대댓글 작성', dailyLimit: 10 },
  like_received: { amount: 10,   label: '일반 게시글 추천받기' },
  popular:       { amount: 1000, label: '인기글 선정' },
  admin_pick:    { amount: 1500, label: '운영자 추천글 선정' },
  streak7:       { amount: 50,   label: '7일 연속 출석' },
  streak14:      { amount: 100,  label: '14일 연속 출석' },
  streak21:      { amount: 150,  label: '21일 연속 출석' },
  streak28:      { amount: 200,  label: '28일 연속 출석' },
  streak30:      { amount: 100,  label: '30일 연속 출석 달성' },
};

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function countToday(userId, reason) {
  return db.prepare(
    `SELECT COUNT(*) AS c FROM point_logs
     WHERE user_id = ? AND reason = ? AND date(created_at) = date('now', 'localtime')`
  ).get(userId, reason).c;
}

// 상점에서 살 수 있는 값. 포인트가 이 값을 넘는 순간 축하 메시지를 띄운다.
// 값은 캐릭터·테두리 카탈로그(src/avatars.js)와 한곳에서 나오게 해 어긋나지 않도록 한다.
const { CHARACTER_PRICE, BORDER_PRICE } = require('./avatars');
const UNLOCK_THRESHOLDS = [
  { points: CHARACTER_PRICE, label: '캐릭터 구매' },
  { points: BORDER_PRICE, label: '테두리 구매' },
];

function crossedUnlocks(before, after) {
  return UNLOCK_THRESHOLDS.filter((t) => before < t.points && after >= t.points);
}

// 다음 해금까지의 진행 상황 (모두 해금했으면 null)
function nextUnlock(points) {
  const next = UNLOCK_THRESHOLDS.find((t) => points < t.points);
  if (!next) return null;
  const reached = [...UNLOCK_THRESHOLDS].reverse().find((t) => points >= t.points);
  const base = reached ? reached.points : 0;
  const remaining = next.points - points;
  const percent = Math.max(0, Math.min(100, Math.round(((points - base) / (next.points - base)) * 100)));
  return { label: next.label, need: next.points, base, remaining, percent };
}

// 포인트 지급. 하루 한도가 차 있으면 지급하지 않고 { awarded: 0, limited: true } 반환.
// 지급으로 해금 기준을 넘었다면 unlocked 배열에 해당 티어가 담긴다.
function award(userId, reason, detail) {
  const rule = RULES[reason];
  if (!rule) throw new Error(`unknown point reason: ${reason}`);
  if (rule.dailyLimit && countToday(userId, reason) >= rule.dailyLimit) {
    return { awarded: 0, limited: true, rule, unlocked: [] };
  }
  const before = db.prepare('SELECT points FROM users WHERE id = ?').get(userId).points;
  db.prepare('INSERT INTO point_logs (user_id, amount, reason, detail) VALUES (?, ?, ?, ?)')
    .run(userId, rule.amount, reason, detail || rule.label);
  db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(rule.amount, userId);
  return {
    awarded: rule.amount, limited: false, rule,
    unlocked: crossedUnlocks(before, before + rule.amount),
  };
}

// 오늘 이미 출석했는지 (매 요청마다 확인하므로 가벼운 단일 조회)
function checkedToday(userId) {
  return !!db.prepare('SELECT 1 FROM attendance WHERE user_id = ? AND day = ?')
    .get(userId, todayStr());
}

// 기준일부터 거꾸로 세어 연속 출석일 수를 구한다 (기준일 미출석이면 0)
function currentStreak(userId, from = new Date()) {
  let streak = 0;
  const cursor = new Date(from);
  const p = (n) => String(n).padStart(2, '0');
  for (;;) {
    const d = `${cursor.getFullYear()}-${p(cursor.getMonth() + 1)}-${p(cursor.getDate())}`;
    if (!db.prepare('SELECT 1 FROM attendance WHERE user_id = ? AND day = ?').get(userId, d)) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// 아직 출석 전이면 "어제까지" 이어온 연속 일수를 본다 (오늘 출석하면 +1일째가 되는 값)
function streakBeforeToday(userId) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return currentStreak(userId, yesterday);
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
// 연속 출석 보너스. 지급 규칙(RULES)과 한 곳에서 나오게 해서 둘이 어긋나지 않도록 한다.
const MILESTONES = [
  { days: 7,  reason: 'streak7' },
  { days: 14, reason: 'streak14' },
  { days: 21, reason: 'streak21' },
  { days: 28, reason: 'streak28' },
  { days: 30, reason: 'streak30', special: true },
].map((m) => ({ ...m, points: RULES[m.reason].amount }));

const CHALLENGE_DAYS = 30; // 30일 연속 출석 챌린지

// 다음 연속 출석 보너스까지 얼마나 남았는지 (다 채웠으면 null)
function nextMilestone(streak) {
  const m = MILESTONES.find((x) => x.days > streak);
  return m ? { ...m, remain: m.days - streak } : null;
}

// 출석부용 최근 7일 도장판. 항상 오른쪽 끝이 오늘이라 연속 기록이 한눈에 보인다.
function recentWeek(userId) {
  const p = (n) => String(n).padStart(2, '0');
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    days.push({
      key,
      label: WEEKDAYS[d.getDay()],
      date: d.getDate(),
      checked: !!db.prepare('SELECT 1 FROM attendance WHERE user_id = ? AND day = ?').get(userId, key),
      today: i === 0,
    });
  }
  return days;
}

// 마이페이지 출석 탭에 필요한 이번 달 달력 + 연속 출석 현황
function attendanceView(userId) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();

  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-%`;
  const checkedDays = new Set(
    db.prepare('SELECT day FROM attendance WHERE user_id = ? AND day LIKE ?')
      .all(userId, prefix).map((r) => Number(r.day.slice(-2)))
  );
  const done = checkedDays.has(now.getDate());

  return {
    year, month: month + 1, daysInMonth, firstWeekday,
    checkedDays, today: now.getDate(),
    checkedToday: done,
    // 출석 전에는 어제까지의 기록을 보여줘야 "0일 연속"으로 보이지 않는다
    streak: done ? currentStreak(userId) : streakBeforeToday(userId),
  };
}

// 출석 처리: 오늘 출석 기록 + 출석 포인트, 연속 출석 보너스(7·14·21·28·30일)
function checkAttendance(userId) {
  const day = todayStr();
  const exists = db.prepare('SELECT 1 FROM attendance WHERE user_id = ? AND day = ?').get(userId, day);
  if (exists) return { already: true };

  db.prepare('INSERT INTO attendance (user_id, day) VALUES (?, ?)').run(userId, day);
  const results = [award(userId, 'attendance')];

  // 오늘을 포함해 연속으로 며칠 출석했는지 계산.
  // 딱 그날짜에 닿았을 때만 보너스를 준다 (31일째에 또 주면 안 된다)
  const streak = currentStreak(userId);
  for (const m of MILESTONES) {
    if (streak === m.days) results.push(award(userId, m.reason));
  }

  return { already: false, streak, results };
}

// 이번 달 출석 횟수 (시안 상단 요약의 '이번 달 출석')
function monthlyCount(userId) {
  return db.prepare(
    "SELECT COUNT(*) AS c FROM attendance WHERE user_id = ? AND day LIKE strftime('%Y-%m-', 'now', 'localtime') || '%'"
  ).get(userId).c;
}

// 30일 챌린지 진행 상황 — 진행바와 구간 표시에 쓴다
function challengeView(streak) {
  const done = Math.min(streak, CHALLENGE_DAYS);
  return {
    days: CHALLENGE_DAYS,
    done,
    remain: Math.max(0, CHALLENGE_DAYS - streak),
    percent: Math.round((done / CHALLENGE_DAYS) * 100),
    marks: MILESTONES.map((m) => ({ ...m, reached: streak >= m.days })),
  };
}

// 지금이 몇 주차인지와, 그 주(7일 묶음)의 각 날짜 상태.
// 시안의 "2주차 출석 도전 — 8일차 … 14일차" 를 그대로 만든다.
function weekChallenge(streak) {
  const week = Math.floor(Math.max(0, streak - (streak > 0 ? 1 : 0)) / 7) + 1;
  const first = (week - 1) * 7 + 1;
  const days = [];
  for (let d = first; d < first + 7; d++) {
    days.push({ day: d, points: RULES.attendance.amount, done: d <= streak, today: d === streak });
  }
  const goal = MILESTONES.find((m) => m.days >= first + 6) || null;
  return { week, days, goal };
}

// 플래시 메시지에 붙일 해금 축하 문구
function unlockMessage(results) {
  const unlocked = results.flatMap((r) => r.unlocked || []);
  if (unlocked.length === 0) return '';
  return ' · ' + unlocked.map((u) => `${u.points.toLocaleString()}P 달성 — ${u.label} 해금!`).join(' ');
}

module.exports = {
  RULES, UNLOCK_THRESHOLDS,
  award, checkAttendance, countToday, todayStr,
  checkedToday, currentStreak, streakBeforeToday, attendanceView,
  recentWeek, nextMilestone, MILESTONES, CHALLENGE_DAYS,
  challengeView, weekChallenge, monthlyCount,
  crossedUnlocks, nextUnlock, unlockMessage,
};
