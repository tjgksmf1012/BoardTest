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

// 포인트 지급. 하루 한도가 차 있으면 지급하지 않고 { awarded: 0, limited: true } 반환
function award(userId, reason, detail) {
  const rule = RULES[reason];
  if (!rule) throw new Error(`unknown point reason: ${reason}`);
  if (rule.dailyLimit && countToday(userId, reason) >= rule.dailyLimit) {
    return { awarded: 0, limited: true, rule };
  }
  db.prepare('INSERT INTO point_logs (user_id, amount, reason, detail) VALUES (?, ?, ?, ?)')
    .run(userId, rule.amount, reason, detail || rule.label);
  db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(rule.amount, userId);
  return { awarded: rule.amount, limited: false, rule };
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

module.exports = { RULES, award, checkAttendance, countToday, todayStr };
