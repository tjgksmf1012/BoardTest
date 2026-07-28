// 알림 생성/조회 헬퍼
const db = require('./db');
const { publish } = require('./realtime');

// 알림 생성 (자기 자신에게는 보내지 않음)
function notify(userId, actorId, message, link) {
  if (userId === actorId) return;
  const added = db.prepare('INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)')
    .run(userId, message, link || null);
  // 그 사람이 화면을 열어두고 있다면 새로고침 없이 바로 알린다
  publish(userId, {
    id: added.lastInsertRowid,
    message,
    link: link || null,
    unread: unreadCount(userId),
  });
}

function unreadCount(userId) {
  return db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0')
    .get(userId).c;
}

module.exports = { notify, unreadCount };
