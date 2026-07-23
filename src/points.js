// 포인트 적립 규칙 (기획안의 "커뮤니티 포인트 제도" 그대로 구현)
const db = require('./db');

const RULES = {
  signup:        { amount: 1000, label: '회원가입' },
  attendance:    { amount: 100,  label: '출석체크' },
  post:          { amount: 300,  label: '일반 게시글 작성', dailyLimit: 3 },
  anon_post:     { amount: 100,  label: '익명 게시글 작성', dailyLimit: 3 },
  comment:       { amount: 100,  label: '댓글·대댓글 작성', dailyLimit: 10 },
  like_received: { amount: 10,   label: '일반 게시글 추천받기' },
  popular:       { amount: 1000, label: '인기글 선정' },
  admin_pick:    { amount: 1500, label: '운영자 추천글 선정' },
  streak3:       { amount: 500,  label: '3일 연속 출석' },
  streak7:       { amount: 1000, label: '7일 연속 출석' },
  streak30:      { amount: 3000, label: '30일 연속 출석' },
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

// 아바타 해금 기준. 포인트가 이 값을 넘는 순간 축하 메시지를 띄운다
const UNLOCK_THRESHOLDS = [
  { points: 5000, label: '스페셜 헤어' },
  { points: 10000, label: '프리미엄 의상' },
  { points: 20000, label: '움직이는 테두리' },
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

// 출석 처리: 오늘 출석 기록 + 100P, 연속 출석 3/7/30일 보너스
function checkAttendance(userId) {
  const day = todayStr();
  const exists = db.prepare('SELECT 1 FROM attendance WHERE user_id = ? AND day = ?').get(userId, day);
  if (exists) return { already: true };

  db.prepare('INSERT INTO attendance (user_id, day) VALUES (?, ?)').run(userId, day);
  const results = [award(userId, 'attendance')];

  // 오늘을 포함해 연속으로 며칠 출석했는지 계산
  let streak = 0;
  const cursor = new Date();
  const p = (n) => String(n).padStart(2, '0');
  for (;;) {
    const d = `${cursor.getFullYear()}-${p(cursor.getMonth() + 1)}-${p(cursor.getDate())}`;
    const row = db.prepare('SELECT 1 FROM attendance WHERE user_id = ? AND day = ?').get(userId, d);
    if (!row) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  if (streak === 3) results.push(award(userId, 'streak3'));
  if (streak === 7) results.push(award(userId, 'streak7'));
  if (streak === 30) results.push(award(userId, 'streak30'));

  return { already: false, streak, results };
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
  crossedUnlocks, nextUnlock, unlockMessage,
};
