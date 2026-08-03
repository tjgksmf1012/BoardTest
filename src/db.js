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
  avatar_id     TEXT NOT NULL DEFAULT '',
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

CREATE TABLE IF NOT EXISTS user_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  item_code  TEXT NOT NULL,          -- public/avatars/manifest.json 의 code
  price      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(user_id, item_code)
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
CREATE INDEX IF NOT EXISTS idx_useritems_user   ON user_items(user_id);
`);

// ---- 마이그레이션 (기존 DB에 새 컬럼 추가) ------------------------------------
// CREATE TABLE IF NOT EXISTS는 이미 있는 테이블에 컬럼을 더해주지 않으므로 직접 확인한다.
function addColumn(table, column, definition) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (has) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

// 본문 형식: 'text'(옛 글 — 그대로 이스케이프해 출력) / 'html'(에디터로 쓴 서식 있는 글)
addColumn('posts', 'content_format', "TEXT NOT NULL DEFAULT 'text'");
// 목록 미리보기·검색용 평문 사본 (HTML 태그가 검색에 걸리지 않도록)
addColumn('posts', 'content_text', 'TEXT');
// 옛 글은 본문이 곧 평문이다
db.exec("UPDATE posts SET content_text = content WHERE content_text IS NULL");

// 댓글 수정 시각 (수정된 댓글에 표시를 남기기 위해)
addColumn('comments', 'updated_at', 'TEXT');
// 답글이 달린 댓글은 지워도 흔적만 남긴다.
// 그냥 지우면 ON DELETE CASCADE로 남이 단 답글까지 함께 사라지기 때문이다.
addColumn('comments', 'is_deleted', 'INTEGER NOT NULL DEFAULT 0');

// 추천 수를 글에 함께 저장한다(비정규화).
// 매번 likes를 세어 정렬하면 글이 늘수록 전체를 훑어야 해서 목록이 느려진다.
// 추천은 취소가 없어 값이 어긋날 일이 적고, 아래 인덱스로 정렬을 인덱스만으로 끝낼 수 있다.
if (addColumn('posts', 'like_count', 'INTEGER NOT NULL DEFAULT 0')) {
  db.exec('UPDATE posts SET like_count = (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id)');
}

// 없어진 말머리(알바후기·구인구직)로 저장된 옛 글을 '자유'로 옮긴다.
// 그대로 두면 어느 탭에도 걸리지 않아 화면에서 사라진다.
db.exec("UPDATE posts SET category = '자유' WHERE category IN ('알바후기', '구인구직')");

// 회원 유형(여성·남성·업소). 어떤 캐릭터를 배정·판매할지 가른다.
// 연동 모드에서는 A사이트가 알려주고, 혼자 띄울 때는 가입 화면에서 고른다.
addColumn('users', 'member_type', "TEXT NOT NULL DEFAULT 'female'");

// 임시로 넣었던 캐릭터(basic-*, hair-*, outfit-*, event-*, border-neon 등)를
// 이번에 받은 이미지로 갈아끼운다. 옛 코드가 남아 있으면 이미지가 깨진다.
db.exec(`
  UPDATE users SET avatar_id = '' WHERE avatar_id LIKE 'basic-%' OR avatar_id LIKE 'hair-%'
    OR avatar_id LIKE 'outfit-%' OR avatar_id LIKE 'event-%';
  UPDATE users SET border_id = NULL WHERE border_id IN ('border-neon', 'border-sunset', 'border-heart');
  DELETE FROM user_items WHERE item_code LIKE 'basic-%' OR item_code LIKE 'hair-%'
    OR item_code LIKE 'outfit-%' OR item_code LIKE 'event-%';
`);

// A사이트(커뮤니티를 삽입할 알바채용 사이트) 회원번호.
// 연동 모드에서는 이 값이 사람을 가리키는 열쇠이고, users 행은 아이디 저장소가 아니라
// 그 회원번호에 매달린 '커뮤니티 프로필'(포인트·아바타·활동)이 된다.
// 혼자 띄우는 모드에서는 비어 있다.
addColumn('users', 'external_id', 'TEXT');
// ALTER TABLE로는 UNIQUE를 걸 수 없어 인덱스로 대신한다 (NULL은 여럿이어도 되므로 딱 맞다)
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_external ON users(external_id)');

// 정렬용 인덱스 — 추천순·조회순이 임시 정렬(TEMP B-TREE) 없이 앞에서 10건만 읽고 끝나게 한다
// 그리고 페이지 수 계산용 COUNT가 본문까지 읽지 않고 인덱스만 훑도록 한다
db.exec(`
CREATE INDEX IF NOT EXISTS idx_posts_likes   ON posts(is_notice, like_count DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_views   ON posts(is_notice, views DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_visible ON posts(is_notice, is_hidden);
`);

// 전문검색용 색인 테이블 (내용은 src/search.js가 두 글자씩 잘라 넣는다)
db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(g, tokenize='unicode61')");

// 추천 수가 어긋난 적이 있어도 기동 때 한 번 맞춰둔다 (데모 데이터 삽입 등)
function syncLikeCounts() {
  db.exec('UPDATE posts SET like_count = (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) WHERE like_count <> (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id)');
}

module.exports = db;
module.exports.syncLikeCounts = syncLikeCounts;
