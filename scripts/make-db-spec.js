// 선배님(PHP 리팩토링) 께 드릴 DB 명세서를 만든다.
//
//   node scripts/make-db-spec.js
//
// 스키마를 손으로 옮겨 적으면 코드가 바뀔 때마다 어긋난다.
// 실제로 돌고 있는 SQLite 스키마를 읽어 MySQL DDL로 옮기고,
// 화면별 주요 쿼리는 여기 적힌 그대로 한 번 실행해 본 뒤 문서에 싣는다.
// (실행에 실패한 쿼리는 문서에 실리지 않고 오류를 낸다)
process.env.TZ = process.env.TZ || 'Asia/Seoul';

const fs = require('fs');
const os = require('os');
const path = require('path');

// 갓 만든 빈 DB에서 스키마를 읽는다.
// 오래 쓴 DB는 SQLite 특성상 컬럼 기본값을 바꿔도 옛 값이 그대로 남아 있어서,
// 그걸 그대로 옮기면 새로 만드는 쪽(PHP)에 틀린 기본값이 전달된다.
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dbspec-')), 'spec.db');
const db = require('../src/db');
require('../src/seed')();   // 쿼리를 실제로 돌려보려면 데이터가 조금 필요하다
const { RULES, MILESTONES } = require('../src/points');
const { CATEGORIES } = require('../src/categories');
const { CHARACTER_PRICE, BORDER_PRICE } = require('../src/avatars');

// 카탈로그 요약 (이미지가 늘면 문서도 같이 늘어난다)
const CATALOG = (() => {
  const avatars = require('../src/avatars');
  const items = avatars.items();
  const label = { female: '여성회원 캐릭터', male: '남성회원 캐릭터', venue: '업소회원 캐릭터',
    anon: '익명 전용', admin: '운영자 전용' };
  const rows = [];
  for (const key of ['female', 'male', 'venue', 'anon', 'admin']) {
    const list = items.filter((i) => i.kind === 'character' && i.memberType === key);
    if (list.length) rows.push(`| ${label[key]} | ${list.length} | \`${list[0].code}\` |`);
  }
  const borders = items.filter((i) => i.kind === 'border');
  if (borders.length) rows.push(`| 테두리 | ${borders.length} | \`${borders[0].code}\` |`);
  const female = items.filter((i) => i.memberType === 'female');
  return {
    total: items.length, rows: rows.join('\n'),
    femaleCount: female.length, themes: avatars.themes('female').length,
  };
})();

const OUT = path.join(__dirname, '..', 'docs', 'DB명세.md');

// ---- SQLite 타입 → MySQL 타입 -------------------------------------------------
// 컬럼 이름과 쓰임새를 함께 보고 정한다. TEXT 를 전부 TEXT 로 옮기면
// 인덱스도 못 걸고 낭비라, 짧은 값은 VARCHAR 로 좁힌다.
const TYPE_MAP = [
  { match: (t, c) => /^id$/i.test(c), type: 'INT UNSIGNED' },
  { match: (t, c) => /_id$/.test(c) && c !== 'external_id' && c !== 'avatar_id' && c !== 'border_id',
    type: 'INT UNSIGNED' },
  { match: (t, c) => /^(created_at|updated_at|last_.*)$/.test(c), type: 'DATETIME' },
  { match: (t, c) => c === 'day', type: 'DATE' },
  { match: (t, c) => /^(is_|block_)/.test(c), type: 'TINYINT(1)' },
  { match: (t, c) => /^(points|views|like_count|amount|price|comment_count)$/.test(c), type: 'INT' },
  { match: (t, c) => c === 'password_hash', type: 'VARCHAR(255)' },
  { match: (t, c) => c === 'username' || c === 'nickname', type: 'VARCHAR(50)' },
  { match: (t, c) => c === 'external_id', type: 'VARCHAR(64)' },
  { match: (t, c) => /^(avatar_id|border_id|item_code)$/.test(c), type: 'VARCHAR(40)' },
  { match: (t, c) => c === 'member_type' || c === 'content_format' || c === 'reason', type: 'VARCHAR(20)' },
  { match: (t, c) => c === 'category', type: 'VARCHAR(20)' },
  { match: (t, c) => c === 'title' || c === 'detail' || c === 'message' || c === 'filename', type: 'VARCHAR(255)' },
  { match: (t, c) => c === 'link', type: 'VARCHAR(255)' },
];
function mysqlType(table, col, sqliteType) {
  for (const r of TYPE_MAP) if (r.match(table, col)) return r.type;
  return /INT/i.test(sqliteType) ? 'INT' : 'TEXT';
}

// 컬럼 뜻풀이 — 표만 있으면 왜 있는 값인지 알 수 없다
const NOTES = {
  'users.external_id': 'A사이트 회원번호. 연동 모드에서 사람을 가리키는 열쇠',
  'users.password_hash': '연동 모드에서는 빈 문자열 (비밀번호를 갖지 않음)',
  'users.member_type': "female / male / venue — 어떤 캐릭터를 배정·판매할지 가른다",
  'users.avatar_id': 'public/avatars/manifest.json 의 code (예: male-03)',
  'users.border_id': '같은 매니페스트의 테두리 code. 없으면 NULL',
  'users.points': '현재 보유 포인트. point_logs 의 합과 같아야 한다',
  'posts.content_format': "text(옛 글, 그대로 이스케이프) / html(에디터 글, 정화 후 저장)",
  'posts.content_text': '검색·미리보기용 평문 사본 (HTML 태그 제외)',
  'posts.like_count': '추천 수 비정규화. 정렬을 인덱스만으로 끝내려고 둔다',
  'posts.is_popular': '인기글 선정 여부 (추천 10개 이상)',
  'posts.admin_picked': '운영자 추천글 선정 여부',
  'posts.is_hidden': '숨김 처리. 일반 회원에게 보이지 않고 운영자만 열람',
  'comments.is_deleted': '답글이 달린 댓글은 지우지 않고 흔적만 남긴다',
  'point_logs.reason': Object.keys(RULES).join(' / ') + ' / purchase',
  'point_logs.amount': '지급은 양수, 구매 차감은 음수',
  'user_items.item_code': '구매한 캐릭터·테두리 code',
  'attendance.day': '출석한 날짜. (user_id, day) 를 UNIQUE 로 묶어 중복 출석을 DB가 막는다',
};

function tableDDL(name) {
  const cols = db.prepare(`PRAGMA table_info(${name})`).all();
  const fks = db.prepare(`PRAGMA foreign_key_list(${name})`).all();
  const idxList = db.prepare(`PRAGMA index_list(${name})`).all();

  const lines = [];
  for (const c of cols) {
    let t = mysqlType(name, c.name, c.type);
    let line = `  \`${c.name}\` ${t}`;
    if (c.name === 'id') { lines.push(line + ' NOT NULL AUTO_INCREMENT'); continue; }
    if (c.notnull) line += ' NOT NULL';
    if (c.dflt_value !== null && c.dflt_value !== undefined) {
      let d = String(c.dflt_value);
      if (/datetime\('now'/i.test(d)) d = 'CURRENT_TIMESTAMP';
      line += ` DEFAULT ${d}`;
    }
    lines.push(line);
  }
  lines.push('  PRIMARY KEY (`id`)');

  // UNIQUE 제약
  for (const ix of idxList) {
    if (!ix.unique) continue;
    const info = db.prepare(`PRAGMA index_info(${ix.name})`).all();
    const cols2 = info.map((i) => `\`${i.name}\``).join(', ');
    const nm = ix.name.startsWith('sqlite_') ? `uq_${name}_${info.map((i) => i.name).join('_')}` : ix.name;
    lines.push(`  UNIQUE KEY \`${nm}\` (${cols2})`);
  }
  // 외래키
  for (const fk of fks) {
    lines.push(`  CONSTRAINT \`fk_${name}_${fk.from}\` FOREIGN KEY (\`${fk.from}\`) `
      + `REFERENCES \`${fk.table}\` (\`${fk.to || 'id'}\`)`
      + (fk.on_delete && fk.on_delete !== 'NO ACTION' ? ` ON DELETE ${fk.on_delete}` : ''));
  }

  return '```sql\nCREATE TABLE `' + name + '` (\n' + lines.join(',\n')
    + '\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n```';
}

function columnTable(name) {
  const cols = db.prepare(`PRAGMA table_info(${name})`).all();
  const rows = cols.map((c) => {
    const note = NOTES[`${name}.${c.name}`] || (c.name === 'id' ? '기본키 (자동 증가)' : '');
    const nullable = c.name === 'id' ? 'N' : (c.notnull ? 'N' : 'Y');
    return `| \`${c.name}\` | ${mysqlType(name, c.name, c.type)} | ${nullable} | ${note} |`;
  });
  return '| 컬럼 | 타입 | NULL | 설명 |\n|---|---|---|---|\n' + rows.join('\n');
}

// ---- 화면별 주요 쿼리 ---------------------------------------------------------
// 여기 적힌 SQL 은 문서에 싣기 전에 실제로 한 번 실행해 본다.
const QUERIES = [
  {
    screen: '목록 (최신순)',
    note: '공지는 위에 고정하고 따로 뽑는다. 숨김 글은 운영자에게만 보인다.',
    sql: `SELECT p.id, p.category, p.title, p.is_anonymous, p.is_hidden, p.like_count, p.views,
       p.created_at, u.nickname, u.avatar_id, u.border_id,
       (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.is_deleted = 0) AS comment_count
FROM posts p JOIN users u ON u.id = p.user_id
WHERE p.is_notice = 0 AND (p.is_hidden = 0 OR ? = 1)
ORDER BY p.id DESC LIMIT 10 OFFSET 0`,
    params: [0],
  },
  {
    screen: '목록 (추천순 / 조회순)',
    note: "수정사항 4번: 최근 일주일 안에서만 줄을 세운다. MySQL 은 datetime(...) 대신 "
      + '`p.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)` 를 쓴다.',
    sql: `SELECT p.id, p.title, p.like_count, p.views
FROM posts p
WHERE p.is_notice = 0 AND p.is_hidden = 0
  AND p.created_at >= datetime('now', 'localtime', '-7 days')
ORDER BY p.like_count DESC, p.id DESC LIMIT 10`,
    params: [],
  },
  {
    screen: '목록 (말머리 필터)',
    note: '탭으로 거를 때. 없어진 말머리는 마이그레이션에서 자유로 옮겼다.',
    sql: `SELECT COUNT(*) AS c FROM posts p
WHERE p.is_notice = 0 AND p.is_hidden = 0 AND p.category = ?`,
    params: ['자유'],
  },
  {
    screen: '검색',
    note: 'SQLite 에서는 FTS5 바이그램 색인으로 후보를 좁히지만, 구버전 MySQL 에는 그 기능이 없다. '
      + '아래 LIKE 방식이 기본이고, MySQL 5.7 이상이라면 `FULLTEXT ... WITH PARSER ngram` 을 권장한다.',
    sql: `SELECT p.id, p.title FROM posts p
WHERE p.is_notice = 0 AND p.is_hidden = 0
  AND (p.title LIKE ? OR p.content_text LIKE ?)
ORDER BY p.id DESC LIMIT 10`,
    params: ['%알바%', '%알바%'],
  },
  {
    screen: '글 상세',
    note: '조회수는 같은 세션에서 한 번만 올린다 (세션에 본 글 목록을 담아 판단).',
    sql: `SELECT p.*, u.nickname, u.avatar_id, u.border_id, u.points AS author_points
FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?`,
    params: [1],
  },
  {
    screen: '댓글 목록',
    note: '한 번에 다 읽고 최상위 20개 단위로 잘라 그린다. 답글은 부모와 같은 쪽에 함께 싣는다.',
    sql: `SELECT c.*, u.nickname, u.avatar_id, u.border_id, u.points AS author_points,
       (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id) AS like_count
FROM comments c JOIN users u ON u.id = c.user_id
WHERE c.post_id = ? ORDER BY c.id`,
    params: [1],
  },
  {
    screen: '출석 — 오늘 출석했는지',
    note: '(user_id, day) 가 UNIQUE 라 두 번 눌러도 DB가 막는다.',
    sql: `SELECT 1 FROM attendance WHERE user_id = ? AND day = ?`,
    params: [1, '2026-01-01'],
  },
  {
    screen: '출석 — 이번 달 출석 횟수',
    note: 'MySQL 은 `DATE_FORMAT(NOW(), "%Y-%m-")` 로 바꿔 쓴다.',
    sql: `SELECT COUNT(*) AS c FROM attendance
WHERE user_id = ? AND day LIKE strftime('%Y-%m-', 'now', 'localtime') || '%'`,
    params: [1],
  },
  {
    screen: '포인트 — 하루 지급 한도 확인',
    note: '글 3개·댓글 10개 한도. 지급 전에 오늘 몇 번 줬는지 센다. '
      + 'MySQL 은 `DATE(created_at) = CURDATE()`.',
    sql: `SELECT COUNT(*) AS c FROM point_logs
WHERE user_id = ? AND reason = ? AND date(created_at) = date('now', 'localtime')`,
    params: [1, 'post'],
  },
  {
    screen: '포인트 — 내역',
    sql: `SELECT * FROM point_logs WHERE user_id = ? ORDER BY id DESC LIMIT 100`,
    params: [1],
  },
  {
    screen: '랭킹 TOP 20',
    sql: `SELECT u.id, u.nickname, u.points, u.avatar_id, u.border_id
FROM users u WHERE u.is_banned = 0 ORDER BY u.points DESC, u.id LIMIT 20`,
    params: [],
  },
  {
    screen: '알림 — 안 읽은 개수',
    note: '모든 화면 상단에서 매번 부르는 쿼리라 인덱스가 중요하다.',
    sql: `SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0`,
    params: [1],
  },
  {
    screen: '캐릭터 — 내가 산 것',
    sql: `SELECT item_code FROM user_items WHERE user_id = ?`,
    params: [1],
  },
];

function runQuery(q) {
  const sql = q.sql.trim();
  try {
    const stmt = db.prepare(sql);
    const rows = stmt.reader ? stmt.all(...q.params) : (stmt.run(...q.params), []);
    return { ok: true, rows: rows.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---- 문서 만들기 --------------------------------------------------------------
const TABLES = db.prepare(
  // sessions 는 로그인 상태를 담아 두는 살림용 표라 옮기실 필요가 없다.
  // PHP 는 세션을 언어가 알아서 관리한다($_SESSION).
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' "
  + "AND name NOT LIKE 'posts_fts%' AND name <> 'sessions' ORDER BY name"
).all().map((r) => r.name);

const TABLE_DESC = {
  users: '회원. 연동 모드에서는 아이디·비밀번호가 아니라 **A사이트 회원번호에 매달린 커뮤니티 프로필**이다.',
  posts: '게시글',
  post_images: '글에 첨부한 사진 (본문에 넣은 사진은 본문 HTML 안에 있고, 이 표는 옛 방식 첨부)',
  comments: '댓글·답글 (parent_id 가 있으면 답글)',
  likes: '글 추천 (취소 없음, 1인 1회)',
  comment_likes: '댓글 좋아요',
  reports: '글 신고',
  comment_reports: '댓글 신고',
  bookmarks: '스크랩',
  attendance: '출석 기록',
  point_logs: '포인트 적립·차감 내역',
  notifications: '알림',
  user_items: '포인트로 산 캐릭터·테두리',
};

const errors = [];
const queryBlocks = QUERIES.map((q) => {
  const r = runQuery(q);
  if (!r.ok) errors.push(`${q.screen}: ${r.error}`);
  return `### ${q.screen}\n${q.note ? q.note + '\n' : ''}\n\`\`\`sql\n${q.sql.trim()}\n\`\`\`\n`;
}).join('\n');

if (errors.length) {
  console.error('문서에 실으려던 쿼리가 실행되지 않았어요:\n - ' + errors.join('\n - '));
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const md = `# DB 스키마 · 쿼리 명세서

> 커뮤니티 게시판을 PHP 로 옮기실 때 참고하시라고 만든 문서입니다.
> 현재 동작 중인 스키마를 그대로 읽어 MySQL 문법으로 옮긴 것이라 실제 코드와 어긋나지 않습니다.
> (\`node scripts/make-db-spec.js\` 로 다시 만들 수 있습니다 · 작성일 ${today})

## 0. 먼저 알아두실 것

- 현재 구현은 **Node.js + SQLite** 입니다. 아래 DDL 은 그 스키마를 **MySQL(InnoDB)** 로 옮긴 것입니다.
- 커뮤니티는 **아이디·비밀번호를 갖지 않습니다.** A사이트 회원번호(\`users.external_id\`)에
  포인트·캐릭터·활동만 매답니다. 자세한 내용은 [연동가이드](연동가이드.md).
- 날짜/시간은 전부 **Asia/Seoul 기준 문자열**로 저장하고 있습니다. MySQL 로 옮기실 때는
  \`DATETIME\` 으로 두고 서버 타임존을 \`+09:00\` 으로 맞춰 주세요.
- 참(true)/거짓은 \`TINYINT(1)\` 의 \`0/1\` 입니다.

### SQLite → MySQL 로 바꿀 때 주의할 함수

| 지금 (SQLite) | MySQL |
|---|---|
| \`datetime('now', 'localtime')\` | \`NOW()\` |
| \`date('now', 'localtime')\` | \`CURDATE()\` |
| \`datetime('now', 'localtime', '-7 days')\` | \`DATE_SUB(NOW(), INTERVAL 7 DAY)\` |
| \`strftime('%Y-%m-', 'now', 'localtime')\` | \`DATE_FORMAT(NOW(), '%Y-%m-')\` |
| \`AUTOINCREMENT\` | \`AUTO_INCREMENT\` |
| \`a || b\` (문자열 잇기) | \`CONCAT(a, b)\` |

---

## 1. 표 한눈에 보기

| 테이블 | 설명 |
|---|---|
${TABLES.map((t) => `| \`${t}\` | ${TABLE_DESC[t] || ''} |`).join('\n')}

---

## 2. 테이블 정의

${TABLES.map((t) => `### \`${t}\`\n${TABLE_DESC[t] || ''}\n\n${columnTable(t)}\n\n${tableDDL(t)}\n`).join('\n')}

---

## 3. 인덱스와 그 이유

목록이 느려지는 지점은 정해져 있어서, 아래 인덱스는 꼭 함께 옮겨 주세요.

\`\`\`sql
-- 목록: 최신순 (공지 분리 + id 역순)
CREATE INDEX idx_posts_list    ON posts (is_notice, id DESC);
-- 목록: 추천순·조회순을 임시 정렬 없이 앞에서 몇 건만 읽고 끝내기 위한 것
CREATE INDEX idx_posts_likes   ON posts (is_notice, like_count DESC, id DESC);
CREATE INDEX idx_posts_views   ON posts (is_notice, views DESC, id DESC);
-- 페이지 수 계산용 COUNT 가 본문까지 읽지 않도록
CREATE INDEX idx_posts_visible ON posts (is_notice, is_hidden);
CREATE INDEX idx_posts_category ON posts (category);
-- 상세·마이페이지
CREATE INDEX idx_comments_post ON comments (post_id);
CREATE INDEX idx_likes_post    ON likes (post_id);
CREATE INDEX idx_bookmarks_user ON bookmarks (user_id);
CREATE INDEX idx_pointlogs_user ON point_logs (user_id, id DESC);
-- 모든 화면 상단에서 매번 부르는 '안 읽은 알림 수'
CREATE INDEX idx_noti_user     ON notifications (user_id, is_read);
CREATE INDEX idx_useritems_user ON user_items (user_id);
\`\`\`

> **추천 수를 posts 에 함께 저장(비정규화)** 하고 있습니다.
> 매번 \`likes\` 를 세어 정렬하면 글이 늘수록 전체를 훑어야 해서 목록이 느려집니다.
> 추천은 취소가 없어 값이 어긋날 일이 적고, 위 인덱스로 정렬을 인덱스만으로 끝낼 수 있습니다.
> 추천을 넣고 뺄 때 \`posts.like_count\` 도 같은 트랜잭션에서 함께 갱신해 주세요.

---

## 4. 화면별 주요 쿼리

아래 SQL 은 문서를 만들 때 **실제로 한 번씩 실행해 본 것**입니다.
(SQLite 문법 그대로라 MySQL 로 옮길 때는 위 함수 대응표를 참고해 주세요.)

${queryBlocks}

---

## 5. 포인트 지급 규칙

지급은 **서버에서만** 합니다. 화면에서 넘어온 금액을 그대로 믿으면 안 됩니다.

| 사유 (\`point_logs.reason\`) | 포인트 | 하루 한도 |
|---|---|---|
${Object.entries(RULES).map(([k, v]) =>
  `| \`${k}\` | ${v.amount.toLocaleString()}P | ${v.dailyLimit ? v.dailyLimit + '회' : '—'} | `).join('\n')}
| \`purchase\` | 음수 (구매 차감) | — |

### 연속 출석 보너스

${MILESTONES.map((m) => `- **${m.days}일 연속** → ${m.points.toLocaleString()}P${m.special ? ' (달성 보너스)' : ''}`).join('\n')}

- 출석은 하루 1회, \`attendance(user_id, day)\` UNIQUE 로 DB가 중복을 막습니다.
- 보너스는 **딱 그 날짜에 닿았을 때만** 줍니다. (8일째에 7일 보너스를 또 주면 안 됩니다)
- 연속이 끊기면 다음 날부터 1일차로 다시 시작합니다.

### 지급 절차 (의사코드)

\`\`\`
지급(회원, 사유):
    규칙 = RULES[사유]
    if 규칙.하루한도 and 오늘지급횟수(회원, 사유) >= 규칙.하루한도:
        return 지급없음          # 활동은 되고 포인트만 안 준다
    트랜잭션:
        point_logs 에 (회원, 규칙.포인트, 사유) 기록
        users.points += 규칙.포인트
\`\`\`

### 구매 절차 (의사코드)

\`\`\`
구매(회원, 항목):
    if 이미보유(회원, 항목): return 중복
    if 회원.포인트 < 항목.가격: return 포인트부족
    트랜잭션:                      # 셋을 한 덩어리로 — 중간에 끊기면 전부 취소
        users.points -= 항목.가격
        user_items 에 (회원, 항목코드, 가격) 기록
        point_logs 에 (회원, -가격, 'purchase') 기록
\`\`\`

- 가격: 캐릭터 ${CHARACTER_PRICE.toLocaleString()}P / 테두리 ${BORDER_PRICE.toLocaleString()}P
- 회원 유형(\`users.member_type\`)이 다른 캐릭터는 목록에도 넣지 않고 구매도 막습니다.

### 캐릭터 목록은 표가 아니라 파일입니다

이미지가 ${CATALOG.total}장이라 표에 한 줄씩 넣으면 관리가 어렵습니다.
목록은 \`public/avatars/manifest.json\` 한 곳에 있고, 표에는 **code 문자열만** 들어갑니다
(\`users.avatar_id\`, \`users.border_id\`, \`user_items.item_code\`).

| 유형 | 개수 | code 예시 |
|---|---:|---|
${CATALOG.rows}

- 여성회원 캐릭터 코드는 \`female-<테마>-<헤어>-<의상>\` 입니다.
  예: \`female-purenatural-5-3\` = 청순 내츄럴 테마 / 헤어 5번 / 의상 3번.
- 상점은 **2단계**입니다. 1단계에서 테마(기본 캐릭터 ${CATALOG.themes}종)를 고르고,
  2단계에서 그 안의 25종을 고릅니다. 한 화면에 ${CATALOG.femaleCount}칸을 깔지 않기 위한 구조입니다.
- 무료로 주어지는 캐릭터: 여성회원은 \`청순 내츄럴\` 맨 아랫줄 5종(가입 화면에서 직접 선택),
  남성·업소회원은 각 유형의 5종 중 무작위 1개.
- 표를 직접 쓰신다면 \`avatar_items(code, kind, member_type, theme, hair, outfit, price, file, thumb)\`
  정도면 충분합니다. manifest.json 이 그대로 그 표의 내용입니다.

---

## 6. 말머리(카테고리)

현재 값은 **${CATEGORIES.map((c) => c.id).join(' · ')}** 입니다.

- 예전에 쓰던 \`알바후기\` \`구인구직\` 은 없앴습니다.
  그 값으로 저장된 글은 어느 탭에도 걸리지 않아 사라진 것처럼 보이므로,
  마이그레이션에서 \`자유\` 로 옮겼습니다.

\`\`\`sql
UPDATE posts SET category = '자유' WHERE category IN ('알바후기', '구인구직');
\`\`\`

---

## 7. 검색에 대해 (한글)

\`LIKE '%검색어%'\` 는 앞에 와일드카드가 있어 **인덱스를 타지 못하고 매번 전체를 훑습니다.**
글이 몇 만 건이 되면 눈에 띄게 느려집니다.

| 방식 | 쓸 수 있는 조건 | 비고 |
|---|---|---|
| \`LIKE '%..%'\` | 어디서나 | 지금 문서의 기본. 수천 건까지는 문제없음 |
| \`FULLTEXT ... WITH PARSER ngram\` | **MySQL 5.7 이상** | 한글 부분일치에 적합. 가능하면 이쪽 권장 |
| 별도 색인 테이블 | 어디서나 | 지금 Node 구현이 쓰는 방식 (두 글자씩 잘라 저장) |

> 현재 Node 구현은 SQLite FTS5 에 **두 글자씩 잘라 넣는 색인**을 씁니다.
> 기본 토크나이저는 띄어쓰기로 단어를 나눠 "주말알바"에서 "알바"를 못 찾고,
> trigram 은 세 글자 이상만 되기 때문입니다. MySQL 의 ngram 파서도 같은 이유로
> \`ngram_token_size=2\` 로 두시길 권합니다.

---

## 8. 옮기실 때 놓치기 쉬운 것

1. **하루 한도는 활동 제한이 아닙니다.** 한도를 넘겨도 글·댓글은 정상으로 써지고,
   포인트만 지급되지 않습니다. (기획서 안내문에도 그렇게 적혀 있습니다)
2. **답글이 달린 댓글은 지우지 않습니다.** \`is_deleted = 1\` 로 표시만 하고 내용을 비웁니다.
   통째로 지우면 남이 단 답글까지 함께 사라집니다.
3. **익명 글은 추천을 받을 수 없습니다.** 추천 버튼이 비활성이고 추천 포인트도 적립되지 않습니다.
4. **제재된 회원**(\`is_banned = 1\`)은 로그인·활동이 막히고, 로그인 상태여도 즉시 끊어야 합니다.
5. **조회수**는 같은 세션에서 한 번만 올립니다. 새로고침마다 올리면 숫자가 의미를 잃습니다.
6. **캐릭터 이미지는 코드에 박지 않았습니다.** \`public/avatars/manifest.json\` 에 목록이 있고,
   \`users.avatar_id\` 에는 그 \`code\` 가 들어갑니다. 이미지가 225장으로 늘어나도 표는 그대로입니다.
`;

fs.writeFileSync(OUT, md);
console.log(`쿼리 ${QUERIES.length}개 실행 확인 · 테이블 ${TABLES.length}개`);
console.log('→ docs/DB명세.md');
