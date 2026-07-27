// SQLite 데이터베이스 연결 및 스키마 정의
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// 테스트에서는 DB_PATH 환경변수로 임시 DB를 사용
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'board.db');
if (!fs.existsSync(path.dirname(DB_PATH))) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nickname      TEXT UNIQUE NOT NULL,
  points        INTEGER NOT NULL DEFAULT 0,
  avatar_id     TEXT NOT NULL DEFAULT 'basic-01',
  border_id     TEXT,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  is_banned     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS posts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  category       TEXT NOT NULL DEFAULT '자유',
  title          TEXT NOT NULL,
  content        TEXT NOT NULL,
  is_anonymous   INTEGER NOT NULL DEFAULT 0,
  block_comments INTEGER NOT NULL DEFAULT 0,
  is_notice      INTEGER NOT NULL DEFAULT 0,
  is_hidden      INTEGER NOT NULL DEFAULT 0,
  is_popular     INTEGER NOT NULL DEFAULT 0,
  admin_picked   INTEGER NOT NULL DEFAULT 0,
  views          INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at     TEXT
);

CREATE TABLE IF NOT EXISTS post_images (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id  INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  filename TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  parent_id  INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS likes (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  UNIQUE(post_id, user_id)
);

CREATE TABLE IF NOT EXISTS attendance (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  day     TEXT NOT NULL,
  UNIQUE(user_id, day)
);

CREATE TABLE IF NOT EXISTS point_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  amount     INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(post_id, user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  message    TEXT NOT NULL,
  link       TEXT,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(user_id, post_id)
);

CREATE TABLE IF NOT EXISTS comment_likes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  UNIQUE(comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS comment_reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(comment_id, user_id)
);

-- 목록/상세에서 자주 조회하는 컬럼 인덱스 (규모 커질 때 성능)
CREATE INDEX IF NOT EXISTS idx_posts_list      ON posts(is_notice, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_category  ON posts(category);
CREATE INDEX IF NOT EXISTS idx_posts_user      ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_post   ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_user   ON comments(user_id);
CREATE INDEX IF NOT EXISTS idx_likes_post      ON likes(post_id);
CREATE INDEX IF NOT EXISTS idx_clikes_comment  ON comment_likes(comment_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user  ON bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_pointlogs_user  ON point_logs(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_noti_user       ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_reports_post    ON reports(post_id);
CREATE INDEX IF NOT EXISTS idx_creports_comment ON comment_reports(comment_id);
`);

// ---- 마이그레이션 (기존 DB에 새 컬럼 추가) ------------------------------------
// CREATE TABLE IF NOT EXISTS는 이미 있는 테이블에 컬럼을 더해주지 않으므로 직접 확인한다.
function addColumn(table, column, definition) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// 본문 형식: 'text'(옛 글 — 그대로 이스케이프해 출력) / 'html'(에디터로 쓴 서식 있는 글)
addColumn('posts', 'content_format', "TEXT NOT NULL DEFAULT 'text'");
// 목록 미리보기·검색용 평문 사본 (HTML 태그가 검색에 걸리지 않도록)
addColumn('posts', 'content_text', 'TEXT');
// 옛 글은 본문이 곧 평문이다
db.exec("UPDATE posts SET content_text = content WHERE content_text IS NULL");

module.exports = db;
