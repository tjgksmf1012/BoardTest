// 알림 생성/조회 헬퍼
const db = require('./db');

// 알림 생성 (자기 자신에게는 보내지 않음)
function notify(userId, actorId, message, link) {
  if (userId === actorId) return;
  db.prepare('INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)')
    .run(userId, message, link || null);
}

function unreadCount(userId) {
  return db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0')
    .get(userId).c;
}

module.exports = { notify, unreadCount };
