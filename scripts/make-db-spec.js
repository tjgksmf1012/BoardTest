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
const { CATEGORIES, RETIRED } = require('../src/categories');
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

// 포인트가 붙는 지점 표.
// 금액·한도를 문서에 손으로 적어 두면 규칙이 바뀔 때 조용히 어긋난다.
// src/points.js 의 RULES 에서 그대로 뽑는다. (WHEN 은 '기존 코드의 어느 자리인지'만 적는다)
const HOOKS = (() => {
  const WHEN = {
    signup: '커뮤니티 첫 방문(가입)',
    attendance: '출석체크 버튼',
    post: '글 등록 (일반)',
    anon_post: '글 등록 (익명)',
    comment: '댓글·대댓글 등록',
    like_received: '내 글이 추천받음',
    popular: '내 글이 인기글이 됨 (추천 10개)',
    admin_pick: '내 글이 운영자 추천글이 됨',
    streak7: '연속 출석 7일', streak14: '연속 출석 14일', streak21: '연속 출석 21일',
    streak28: '연속 출석 28일', streak30: '연속 출석 30일 달성',
  };
  // 한도는 '몇 번까지' 만 적으면 못 만드신다. **무엇으로 막는지**까지 적는다.
  const HOW = {
    signup: '딱 한 번. 회원을 만들 때만 부르면 되고 따로 확인 안 해도 된다',
    attendance: '하루 한 번. attendance 표의 (user_id, day) UNIQUE 가 막아 준다',
    like_received: '제한 없음. 추천 하나당 준다',
    popular: '글 하나에 한 번. posts.is_popular 를 세워서 두 번 안 준다',
    admin_pick: '글 하나에 한 번. posts.admin_picked 를 세워서 두 번 안 준다',
  };
  const rows = Object.entries(RULES).map(([reason, r]) => {
    const limit = r.dailyLimit ? `하루 ${r.dailyLimit}개. 오늘 point_logs 를 세어서 판단한다`
      : HOW[reason] || (/^streak/.test(reason)
        ? '연속 일수가 딱 그 날일 때만. 하루 더 채웠다고 또 주면 안 된다'
        : '제한 없음');
    return `| ${WHEN[reason] || r.label} | \`${reason}\` | ${r.amount.toLocaleString()}P | ${limit} |`;
  });
  return '| 언제 | reason | 금액 | 몇 번까지, 무엇으로 막나 |\n|---|---|---:|---|\n' + rows.join('\n');
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
  'users.external_id': 'A사이트 회원번호. 연동했을 때 사람을 알아보는 값',
  'users.password_hash': '연동해서 쓰면 빈 문자열. 커뮤니티는 비밀번호를 안 갖는다',
  'users.member_type': 'female, male, venue 중 하나. 어떤 캐릭터를 주고 팔지 가른다',
  'users.avatar_id': 'public/avatars/manifest.json 에 적힌 code. male-03 이런 모양',
  'users.border_id': '같은 파일의 테두리 code. 안 끼고 있으면 NULL',
  'users.points': '지금 갖고 있는 포인트. point_logs 를 다 더한 값과 같아야 한다',
  'posts.content_format': 'text 는 옛날 글, html 은 에디터로 쓴 글. 저장 전에 위험한 태그를 걸러 낸다',
  'posts.content_text': '검색과 미리보기에 쓰는 글자만 남긴 사본. 태그가 빠져 있다',
  'posts.like_count': '추천 수를 여기 같이 저장해 둔다. 매번 세면 목록이 느려져서',
  'posts.is_popular': '인기글로 뽑혔는지. 추천 10개 넘으면 선다',
  'posts.admin_picked': '운영자 추천글로 뽑혔는지',
  'posts.is_hidden': '숨김 처리. 일반 회원한테는 안 보이고 운영자만 볼 수 있다',
  'comments.is_deleted': '답글이 달린 댓글은 진짜로 지우지 않고 이걸로 표시만 한다',
  'point_logs.reason': Object.keys(RULES).join(' / ') + ' / purchase',
  'point_logs.amount': '줄 때는 양수, 살 때 빠지는 건 음수',
  'user_items.item_code': '사 놓은 캐릭터나 테두리의 code',
  'attendance.day': '출석한 날짜. user_id 와 묶어 UNIQUE 라 하루 두 번은 DB 가 막는다',
};

function tableDDL(name) {
  const cols = db.prepare(`PRAGMA table_info(${name})`).all();
  const fks = db.prepare(`PRAGMA foreign_key_list(${name})`).all();
  const idxList = db.prepare(`PRAGMA index_list(${name})`).all();

  const lines = [];
  const notes = {};   // 줄 번호 → 줄 끝에 붙일 설명 (쉼표 뒤에 붙는다)
  for (const c of cols) {
    let t = mysqlType(name, c.name, c.type);
    let line = `  \`${c.name}\` ${t}`;
    if (c.name === 'id') { lines.push(line + ' NOT NULL AUTO_INCREMENT'); continue; }
    if (c.notnull) line += ' NOT NULL';
    if (c.dflt_value !== null && c.dflt_value !== undefined) {
      let d = String(c.dflt_value);
      // 시각 기본값은 넣지 않는다.
      // DATETIME 컬럼에 DEFAULT CURRENT_TIMESTAMP 를 쓸 수 있게 된 건 MySQL 5.6.5 부터고,
      // 그 전에는 TIMESTAMP 컬럼에만, 그것도 표당 하나만 허용된다.
      // 옮겨 갈 곳이 PHP 5.1 세대(대개 MySQL 5.0)라 그대로 두면 CREATE TABLE 자체가 실패한다.
      // 넣을 때 NOW() 를 함께 적는 쪽이 어느 버전에서나 돈다.
      // 주석은 줄 끝에 붙이는데, 쉼표보다 앞에 오면 -- 가 쉼표까지 삼켜 SQL 이 깨진다.
      // 그래서 표시만 해 두고 쉼표를 찍은 뒤에 붙인다(아래 join).
      if (/datetime\('now'/i.test(d)) { lines.push(line); notes[lines.length - 1] = '넣을 때 NOW() 를 함께 적어 주세요'; continue; }
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

  // utf8mb4 는 MySQL 5.5.3 부터다. 옮겨 갈 곳이 그보다 옛 버전일 수 있어 utf8 로 낸다.
  // (5.5.3 이상이면 utf8mb4 로 바꾸는 편이 낫다 — 이모지가 안 깨진다. 0장에 적어 뒀다)
  const body = lines
    .map((l, i) => l + (i < lines.length - 1 ? ',' : '') + (notes[i] ? `   -- ${notes[i]}` : ''))
    .join('\n');
  return '```sql\nCREATE TABLE `' + name + '` (\n' + body
    + '\n) ENGINE=InnoDB DEFAULT CHARSET=utf8;\n```';
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
    note: '전체 기간으로 줄을 세운다. 인덱스 idx_posts_likes 가 그대로 받아 주므로 '
      + '따로 줄 세우는 일 없이 앞에서 몇 건만 읽고 끝난다.',
    sql: `SELECT p.id, p.title, p.like_count, p.views
FROM posts p
WHERE p.is_notice = 0 AND p.is_hidden = 0
ORDER BY p.like_count DESC, p.id DESC LIMIT 10`,
    params: [],
  },
  {
    screen: '목록 (말머리 필터)',
    note: '탭으로 거를 때 쓴다. 없앤 말머리로 저장돼 있던 글은 자유로 옮겨 뒀다.',
    sql: `SELECT COUNT(*) AS c FROM posts p
WHERE p.is_notice = 0 AND p.is_hidden = 0 AND p.category = ?`,
    params: ['자유'],
  },
  {
    screen: '검색',
    note: '지금 프로그램은 본문을 두 글자씩 잘라 만든 색인으로 후보를 좁히는데, 옛날 MySQL 에는 '
      + '그 기능이 없다. 그래서 아래 LIKE 방식을 기본으로 적었다. '
      + 'MySQL 5.7 이상이면 `FULLTEXT ... WITH PARSER ngram` 쪽을 권한다.',
    sql: `SELECT p.id, p.title FROM posts p
WHERE p.is_notice = 0 AND p.is_hidden = 0
  AND (p.title LIKE ? OR p.content_text LIKE ?)
ORDER BY p.id DESC LIMIT 10`,
    params: ['%알바%', '%알바%'],
  },
  {
    screen: '글 상세',
    note: '조회수는 같은 사람이 새로고침해도 한 번만 올린다. 이미 본 글 번호를 세션에 담아 두고 판단한다.',
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
  users: '회원. 연동해서 쓰면 아이디와 비밀번호가 아니라 A사이트 회원번호에 매달린 커뮤니티 프로필이 된다',
  posts: '게시글',
  post_images: '글에 붙인 사진. 본문 안에 넣은 사진은 본문 HTML 에 들어 있고, 이 표는 옛날 방식 첨부다',
  comments: '댓글과 답글. parent_id 가 있으면 답글이다',
  likes: '글 추천. 취소는 없고 한 사람이 한 번만 할 수 있다',
  comment_likes: '댓글 좋아요',
  reports: '글 신고',
  comment_reports: '댓글 신고',
  bookmarks: '스크랩',
  attendance: '출석 기록',
  point_logs: '포인트가 들어오고 나간 내역',
  notifications: '알림',
  user_items: '포인트로 산 캐릭터와 테두리',
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
const md = `# DB 표와 쿼리 정리

커뮤니티 게시판을 PHP 로 옮기실 때 보시라고 만든 문서입니다.
지금 돌고 있는 프로그램에서 표 구조를 그대로 읽어다가 MySQL 문법으로 옮겨 적은 것이라
실제 코드하고 어긋날 일이 없습니다. \`node scripts/make-db-spec.js\` 를 치면 다시 만들어집니다.
이 문서는 ${today} 에 만들었습니다.

## 0. 먼저 알아 두실 것

지금 프로그램은 Node.js 로 만들었고 DB 는 SQLite 를 씁니다. 아래에 적은 표 만드는 SQL 은
그 구조를 MySQL 로 옮긴 것입니다.

커뮤니티는 아이디랑 비밀번호를 안 갖고 있습니다. 채용 사이트(문서에서 'A사이트' 라고 부르는
쪽) 회원번호를 \`users.external_id\` 에 받아 두고, 여기에 포인트랑 캐릭터, 활동 기록만
매답니다. 왜 이렇게 했는지는 [연동가이드](연동가이드.md)에 적어 뒀습니다.

날짜와 시각은 전부 한국 시간 기준 문자열로 저장하고 있습니다. MySQL 로 옮기실 때는
\`DATETIME\` 으로 두시고 서버 시간대를 \`+09:00\` 으로 맞춰 주세요.
참과 거짓은 \`TINYINT(1)\` 에 0 아니면 1 로 넣습니다.

### 옛날 서버에 맞춰서 낮춰 둔 것들

PHP 5.1 은 2005년, 2006년쯤 나온 버전입니다. 그 시절 서버면 MySQL 도 대개 5.0 입니다.
그래서 아래 SQL 은 MySQL 5.0 에서 그대로 돌아가게끔 낮춰서 적었습니다. 이런 것들입니다.

요즘은 문자셋을 \`utf8mb4\` 로 쓰는데 그건 MySQL 5.5.3 부터 되는 것이라 여기서는 \`utf8\` 로
적었습니다. 시각 칸에 \`DEFAULT CURRENT_TIMESTAMP\` 를 붙이는 것도 5.6.5 부터라서 안 썼고,
대신 값을 넣을 때 \`NOW()\` 를 같이 적게 했습니다. 검색은 InnoDB 의 \`FULLTEXT\` 가 5.6 부터,
한글 부분일치에 쓰는 \`ngram\` 은 5.7 부터라서 그냥 \`LIKE\` 기준으로 적어 뒀습니다. 검색 얘기는
7장에 따로 있습니다.

이 중에 \`DEFAULT CURRENT_TIMESTAMP\` 를 특히 조심하셔야 합니다. 옛날 MySQL 에서는 이걸
\`TIMESTAMP\` 칸에만, 그것도 표 하나에 한 칸에만 붙일 수 있습니다. 그래서 여러 칸에 붙여 두면
표를 만드는 것 자체가 실패합니다. 그래서 시각 칸에는 기본값을 아예 안 넣고
\`INSERT ... (created_at) VALUES (..., NOW())\` 이런 식으로 넣게 해 뒀습니다.

그리고 이모지는 못 담습니다. MySQL 5.0 의 \`utf8\` 은 한 글자를 3바이트까지만 담는데
이모지는 4바이트라서 잘리거나 오류가 납니다. 지금 데모 글 제목에도 \`☺\` 가 하나 들어 있습니다.
서버 MySQL 이 5.5.3 이상이면 \`utf8\` 을 전부 \`utf8mb4\` 로 바꾸시는 게 낫고, 5.0 이면
글쓰기에서 4바이트짜리 글자를 걸러 주셔야 합니다.

### PHP 5.1 에 아직 없는 것들

JSON 을 읽고 쓰는 \`json_decode\`, \`json_encode\` 는 PHP 5.2 부터 생겼습니다.
그래서 캐릭터 목록을 JSON 대신 PHP 배열 파일(\`docs/avatars.php\`)로 뽑아 뒀습니다.
날짜 다루는 \`DateTime\` 클래스도 5.2 부터라 \`strtotime()\` 과 \`date()\` 를 쓰시면 됩니다.
비밀번호를 다루는 \`password_hash\` 는 5.5 부터인데, 연동해서 쓰시면 커뮤니티 쪽에는
비밀번호 자체가 없어서 쓸 일이 없습니다. 이름 없는 함수(클로저)와 네임스페이스는 5.3 부터라
안 썼습니다.

캐릭터 목록은 \`docs/avatars.php\` 를 쓰시면 됩니다. 지금 Node 쪽은
\`public/avatars/manifest.json\` 을 읽는데 PHP 5.1 에는 그 파일을 읽을 방법이 없어서,
같은 내용을 PHP 배열로 다시 뽑아 놓은 것입니다. 대괄호로 배열 쓰는 것도 5.4 부터라
\`array()\` 로 적었습니다.

\`\`\`php
$avatars = include 'avatars.php';
foreach ($avatars as $a) {
    echo $a['code'], ' ', $a['name'];   // female-glamgold-2-2 / 글램 골드 2-2
}
\`\`\`

여기 \`code\` 값이 \`users.avatar_id\`, \`users.border_id\`, \`user_items.item_code\` 에
들어가는 값입니다. 그림 파일은 \`public/avatars/\` 아래에 있는데 \`file\` 이 본문용 큰 그림,
\`thumb\` 이 작은 그림입니다. 나중에 캐릭터가 늘어나면 이 파일도 같이 다시 만들어집니다.

SQL 에 값을 넣으실 때는 문자열에 그냥 붙이지 마시고 따로 넘겨 주세요.
PDO 나 mysqli 가 없고 옛날 \`mysql_*\` 함수만 있는 서버라면
\`mysql_real_escape_string()\` 을 빠짐없이 거치셔야 합니다. 이걸 안 하면 남이 검색창에
SQL 을 적어 넣어서 DB 를 통째로 읽어 갈 수 있습니다. 지금 Node 쪽은 모든 쿼리가 그렇게
되어 있으니 그 부분만 옮기시면 됩니다.

### SQLite 에서 MySQL 로 바꿀 때 달라지는 함수

여기 왼쪽이 지금 코드에 적혀 있는 것이고 오른쪽이 MySQL 에서 쓰실 것입니다.

| 지금 (SQLite) | MySQL |
|---|---|
| \`datetime('now', 'localtime')\` | \`NOW()\` |
| \`date('now', 'localtime')\` | \`CURDATE()\` |
| \`datetime('now', 'localtime', '-7 days')\` | \`DATE_SUB(NOW(), INTERVAL 7 DAY)\` |
| \`strftime('%Y-%m-', 'now', 'localtime')\` | \`DATE_FORMAT(NOW(), '%Y-%m-')\` |
| \`AUTOINCREMENT\` | \`AUTO_INCREMENT\` |
| \`a || b\` (글자 잇기) | \`CONCAT(a, b)\` |

---

## 0-1. 확인한 것과 그냥 짐작한 것

솔직하게 갈라서 적겠습니다. 저는 옮겨 가실 서버를 한 번도 본 적이 없습니다.

확인한 것부터 말씀드리면, 아래에 적힌 표 만드는 SQL 은 쉼표랑 괄호가 맞는지 문서를 만들 때마다
자동으로 훑어보게 해 뒀습니다. 어긋나면 문서가 아예 안 만들어집니다. 4장의 화면별 쿼리도
문서에 싣기 전에 한 번씩 실제로 돌려 보고 넣습니다. 같이 드린 PHP 파일들이 5.1 문법인지는
\`node scripts/check-php51.js\` 로 확인하고 있고, 연동 토큰 예제도 그 방식으로 만든 토큰이
제대로 통과하는지 확인하는 테스트가 있습니다.

반대로 짐작만 하고 적은 것도 있습니다. MySQL 이 5.0 대일 거라고 봤는데, PHP 5.1 서버면
대개 그렇기 때문입니다. 더 높은 버전이면 \`utf8mb4\` 를 쓰시는 게 낫습니다. 기존 회원 표에
칸을 더 붙일 수 있다고 봤습니다. 포인트랑 캐릭터를 어딘가에는 매달아야 해서요. 만약 회원 표를
못 건드리는 상황이면 따로 표를 빼는 방법도 있으니 말씀해 주세요. 글이랑 댓글 표는 이미 있다고
봤습니다. 커뮤니티가 이미 있다고 하셔서 그렇게 뒀는데, 혹시 없으면 2장에 있는 SQL 을 그대로
쓰시면 됩니다. 회원 아이디 칸이 숫자일 거라고 봤는데 문자열이면 연결되는 칸 타입도 같이
맞춰 주셔야 합니다.

그리고 한 가지 미리 말씀드릴 게 있습니다. 4장의 쿼리는 지금 프로그램(SQLite)에서 한 번씩
돌려 보고 확인한 것인데, MySQL 문법으로는 제가 손으로 옮겨 적었습니다. MySQL 에서 직접
돌려 보지는 못했습니다. 날짜 함수처럼 바뀌는 부분은 바로 위에 표로 정리해 뒀지만,
옮기신 다음에 한 번씩 돌려 봐 주시면 좋겠습니다.

서버 정보를 알려 주시면 위에 짐작으로 적은 것들을 실제 값으로 바꾸겠습니다.
\`docs/check-server.php\` 를 웹 폴더에 올리시고 브라우저로 열면 PHP 와 MySQL 버전, 문자셋,
시간대, 필요한 확장이 깔려 있는지, 회원 표에 어떤 칸이 없는지가 한 화면에 다 나옵니다.
이 파일은 아주 옛날 서버에서도 돌게 PHP 4 문법으로만 썼습니다.
보시고 나면 꼭 지워 주세요. 서버 정보가 그대로 드러나는 파일이라 남겨 두면 위험합니다.

---

## 0-2. 기존 커뮤니티에 이식하실 거면 여기부터 보세요

이 프로그램은 게시판을 처음부터 만든 것이라 글, 댓글, 추천 같은 표가 다 들어 있습니다.
그런데 기존 사이트에 커뮤니티가 이미 있으면 그 표들은 쓰실 일이 없습니다.
새로 붙이셔야 하는 건 이 프로젝트에만 있는 기능, 그러니까 포인트와 출석, 캐릭터뿐입니다.

표를 세 갈래로 나눠 보면 이렇습니다.

| 갈래 | 표 | 어떻게 하시면 되나 |
|---|---|---|
| 이미 있으실 것 | \`users\` \`posts\` \`comments\` \`likes\` \`comment_likes\` \`reports\` \`comment_reports\` \`bookmarks\` \`post_images\` | 기존 표 그대로 쓰시고 아래 칸만 보태기 |
| 새로 만드실 것 | \`point_logs\` \`attendance\` \`user_items\` \`notifications\` | 이 넷이 핵심입니다 |
| 안 옮기셔도 될 것 | \`posts_fts\` | 검색 색인입니다. 기존 검색 쓰시면 됩니다 |

새로 만드실 표 네 개가 이 일의 대부분입니다. 기존 커뮤니티에는 없을 가능성이 큽니다.

### 기존 회원 표에 붙이실 칸

| 칸 | 타입 | 왜 필요한가 |
|---|---|---|
| \`points\` | INT NOT NULL DEFAULT 0 | 지금 갖고 있는 포인트 |
| \`avatar_id\` | VARCHAR(40) NOT NULL DEFAULT '' | 쓰고 있는 캐릭터 code |
| \`border_id\` | VARCHAR(40) NULL | 쓰고 있는 테두리 code |
| \`member_type\` | VARCHAR(20) NOT NULL DEFAULT 'female' | 여성인지 남성인지 업소인지. 어떤 캐릭터를 보여 줄지 가릅니다 |

글 표에는 인기글이랑 운영자 추천을 쓰실 거면 \`is_popular\` 와 \`admin_picked\` 정도만
있으면 됩니다. 둘 다 \`TINYINT(1) NOT NULL DEFAULT 0\` 으로 두시면 됩니다.

### 포인트를 주는 자리

기존 게시판 코드에서 아래 일들이 성공한 바로 다음에 포인트 주는 함수를 한 줄 부르시면 됩니다.

${HOOKS}

연속 출석 보너스는 그날 연속 일수가 딱 7일, 14일, 21일, 28일, 30일일 때만 줍니다.
그래서 8일째에는 또 주지 않고, 연속이 끊겼다가 다시 7일을 채우면 그때 다시 받습니다.
다시 도전할 맛이 나라고 일부러 그렇게 뒀습니다.

하루 한도는 글을 못 쓰게 막는 게 아닙니다. 한도를 넘겨도 글이랑 댓글은 정상으로 써지고
포인트만 안 붙습니다. 오늘 몇 번 받았는지는 \`point_logs\` 를 세어서 판단합니다.

\`\`\`sql
-- 오늘 이 사유로 몇 번 받았나. 이 수를 한도와 비교합니다
SELECT COUNT(*) FROM point_logs
 WHERE user_id = ? AND reason = ? AND DATE(created_at) = CURDATE();

-- 포인트 주기. 아래 두 문장은 반드시 하나로 묶어서 실행해 주세요
INSERT INTO point_logs (user_id, amount, reason, detail, created_at)
VALUES (?, ?, ?, ?, NOW());
UPDATE users SET points = points + ? WHERE id = ?;
\`\`\`

### 관리자에서 게시판을 늘릴 수 있어야 한다면

지금은 말머리(${CATEGORIES.map((c) => c.id).join(', ')})를 코드 안에 적어 두고 있습니다.
\`src/categories.js\` 파일입니다. 관리자 화면에서 게시판을 늘리시는 구조라면 그쪽 게시판 표를
쓰시고 저희 말머리 개념은 버리셔도 됩니다.

포인트 규칙은 게시판이 몇 개든 상관없이 그대로 돌아갑니다. 다만 "글 쓰면 300P" 를 게시판마다
다르게 주고 싶으시면 \`point_logs\` 에 \`board_id\` 칸을 하나 더 두시는 편이 나중에 편합니다.

---

## 1. 표 한눈에 보기

| 테이블 | 설명 |
|---|---|
${TABLES.map((t) => `| \`${t}\` | ${TABLE_DESC[t] || ''} |`).join('\n')}

---

## 2. 테이블 정의

${TABLES.map((t) => `### \`${t}\`\n${TABLE_DESC[t] || ''}\n\n${columnTable(t)}\n\n${tableDDL(t)}\n`).join('\n')}

---

## 3. 인덱스와 그걸 왜 걸었는지

목록이 느려지는 자리는 정해져 있습니다. 아래 인덱스는 꼭 같이 옮겨 주세요.

\`\`\`sql
-- 목록 최신순. 공지를 위로 올리고 나머지는 번호 역순으로
CREATE INDEX idx_posts_list    ON posts (is_notice, id DESC);
-- 추천순, 조회순. 이게 없으면 글을 전부 읽어서 줄 세운 다음에 앞의 20개만 보여 줍니다
CREATE INDEX idx_posts_likes   ON posts (is_notice, like_count DESC, id DESC);
CREATE INDEX idx_posts_views   ON posts (is_notice, views DESC, id DESC);
-- 페이지 수 세는 COUNT 가 본문까지 읽지 않게
CREATE INDEX idx_posts_visible ON posts (is_notice, is_hidden);
CREATE INDEX idx_posts_category ON posts (category);
-- 상세·마이페이지
CREATE INDEX idx_comments_post ON comments (post_id);
CREATE INDEX idx_likes_post    ON likes (post_id);
CREATE INDEX idx_bookmarks_user ON bookmarks (user_id);
CREATE INDEX idx_pointlogs_user ON point_logs (user_id, id DESC);
-- 화면 위쪽 종 모양에 뜨는 '안 읽은 알림 수'. 모든 화면에서 매번 부릅니다
CREATE INDEX idx_noti_user     ON notifications (user_id, is_read);
CREATE INDEX idx_useritems_user ON user_items (user_id);
\`\`\`

한 가지 말씀드릴 게 있는데, 추천 수를 \`likes\` 표에서 매번 세지 않고 \`posts.like_count\` 에
같이 저장해 두고 있습니다. 매번 세어서 줄을 세우면 글이 늘어날수록 목록이 눈에 띄게 느려지기
때문입니다. 추천은 취소가 없어서 두 값이 어긋날 일도 별로 없고, 위에 걸어 둔 인덱스만으로
정렬이 끝나서 훨씬 빠릅니다. 대신 추천을 넣고 뺄 때 \`posts.like_count\` 도 같이 고쳐 주셔야
하고, 두 문장을 하나로 묶어서 실행해 주셔야 합니다.

---

## 4. 화면별로 쓰는 쿼리

아래 SQL 은 문서를 만들 때 실제로 한 번씩 돌려 보고 넣은 것입니다.
SQLite 문법 그대로라 MySQL 로 옮기실 때는 위에 있는 함수 대응표를 봐 주세요.

${queryBlocks}

---

## 5. 포인트 규칙

포인트는 서버에서만 계산해서 줘야 합니다. 화면에서 넘어온 금액을 그대로 믿고 넣으면
브라우저에서 값을 고쳐 보내는 것만으로 포인트를 마음대로 만들 수 있게 됩니다.

| 사유 (\`point_logs.reason\`) | 포인트 | 하루 한도 |
|---|---|---|
${Object.entries(RULES).map(([k, v]) =>
  `| \`${k}\` | ${v.amount.toLocaleString()}P | ${v.dailyLimit ? v.dailyLimit + '회' : '—'} | `).join('\n')}
| \`purchase\` | 음수 (구매 차감) | — |

### 연속 출석 보너스

${MILESTONES.map((m) => `- **${m.days}일 연속** → ${m.points.toLocaleString()}P${m.special ? ' (달성 보너스)' : ''}`).join('\n')}

출석은 하루에 한 번만 됩니다. \`attendance\` 표의 \`user_id\` 와 \`day\` 를 UNIQUE 로 묶어 둬서
DB 가 알아서 막아 줍니다. 보너스는 딱 그 날짜에 닿았을 때만 줍니다. 8일째에 7일 보너스를
또 주면 안 되니까요. 연속이 끊기면 다음 날부터 1일차로 다시 시작합니다.

### 포인트 주는 순서

\`\`\`
포인트주기(회원, 사유):
    규칙 = 사유별 규칙표에서 꺼내기
    만약 하루 한도가 있고, 오늘 이미 그만큼 받았으면:
        아무것도 안 주고 끝냄          # 글은 정상으로 써지고 포인트만 안 붙음
    아래 두 줄을 하나로 묶어서:
        point_logs 에 (회원, 금액, 사유) 남기기
        users.points 에 금액 더하기
\`\`\`

### 사는 순서

\`\`\`
사기(회원, 물건):
    이미 갖고 있으면: 중복이라고 알려 주고 끝냄
    포인트가 값보다 적으면: 모자란다고 알려 주고 끝냄
    아래 세 줄을 하나로 묶어서:     # 중간에 끊기면 셋 다 없던 일로
        users.points 에서 값만큼 빼기
        user_items 에 (회원, 물건코드, 값) 남기기
        point_logs 에 (회원, 마이너스 값, 'purchase') 남기기
\`\`\`

값은 캐릭터가 ${CHARACTER_PRICE.toLocaleString()}P, 테두리가 ${BORDER_PRICE.toLocaleString()}P 입니다.
회원 유형(\`users.member_type\`)에 안 맞는 캐릭터는 상점 목록에 아예 안 띄우고, 혹시 코드를
직접 넣어서 사려고 해도 막습니다.

### 캐릭터 목록은 표가 아니라 파일에 있습니다

그림이 ${CATALOG.total}장이라 표에 한 줄씩 넣으면 관리가 힘듭니다. 그래서 목록은
\`public/avatars/manifest.json\` 한 곳에만 두고, DB 에는 code 문자열만 들어갑니다.
\`users.avatar_id\`, \`users.border_id\`, \`user_items.item_code\` 이 세 군데입니다.

| 유형 | 개수 | code 예시 |
|---|---:|---|
${CATALOG.rows}

여성회원 캐릭터 코드는 \`female-테마-헤어-의상\` 모양입니다. 예를 들어
\`female-purenatural-5-3\` 이면 청순 내츄럴 테마에 헤어 5번, 의상 3번이라는 뜻입니다.

상점은 두 단계로 되어 있습니다. 먼저 테마 ${CATALOG.themes}종 중에 하나를 고르고, 그 안에서
25종 중에 하나를 고르는 식입니다. 여성 캐릭터만 ${CATALOG.femaleCount}종이라 한 화면에
다 깔면 못 보기 때문에 이렇게 나눴습니다.

공짜로 주는 캐릭터도 있습니다. 여성회원은 청순 내츄럴 맨 아랫줄 5종 중에 가입 화면에서 직접
고르고, 남성회원과 업소회원은 각자 유형의 5종 중에 하나를 무작위로 받습니다.

혹시 캐릭터 목록을 파일 말고 DB 표로 두고 싶으시면
\`avatar_items(code, kind, member_type, theme, hair, outfit, price, file, thumb)\`
정도면 충분합니다. manifest.json 안에 들어 있는 게 딱 그 내용입니다.

---

## 6. 말머리

지금 쓰는 말머리는 ${CATEGORIES.map((c) => c.id).join(', ')} 입니다.
${CATEGORIES.filter((c) => c.adminOnly).length
  ? CATEGORIES.filter((c) => c.adminOnly).map((c) => c.id).join(', ')
    + ' 말머리는 운영자만 글을 쓸 수 있습니다.\n'
    + '읽는 건 누구나 됩니다. 화면에서 감추는 것만으로는 못 막습니다.\n'
    + '폼 값은 얼마든지 고쳐 보낼 수 있어서 서버에서 한 번 더 봐야 합니다.'
  : ''}

예전에 쓰던 말머리 ${Object.keys(RETIRED).join(', ')} 는 이제 없습니다. 그런데 그 말머리로 저장된 글은
어느 탭에도 안 걸려서 사라진 것처럼 보입니다. 그래서 아래 SQL 로 자유 말머리로 옮겼습니다.

\`\`\`sql
UPDATE posts SET category = '자유' WHERE category IN (${Object.keys(RETIRED).map((k) => `'${k}'`).join(', ')});
\`\`\`

---

## 7. 한글 검색에 대해서

\`LIKE '%검색어%'\` 는 앞에 \`%\` 가 붙어 있어서 인덱스를 못 씁니다. 검색할 때마다 글을 처음부터
끝까지 다 읽어야 한다는 뜻이라, 글이 몇 만 건 되면 눈에 띄게 느려집니다.

그래도 수천 건까지는 \`LIKE\` 로도 별 문제 없습니다. 이 문서의 쿼리도 그 기준으로 적었습니다.
MySQL 이 5.7 이상이면 \`FULLTEXT ... WITH PARSER ngram\` 을 쓰시는 게 제일 좋습니다.
버전이 안 되면 색인 표를 따로 두는 방법도 있는데, 지금 Node 쪽이 그렇게 하고 있습니다.

지금은 본문을 두 글자씩 잘라서 색인에 넣어 두고 검색어도 똑같이 잘라서 찾습니다.
기본 방식은 띄어쓰기로 단어를 나누기 때문에 "주말알바" 에서 "알바" 를 못 찾고,
세 글자 단위로 자르는 방식은 "알바" 나 "카페" 같은 두 글자 검색이 안 됩니다.
MySQL 의 ngram 을 쓰실 때도 같은 이유로 \`ngram_token_size=2\` 로 두시길 권합니다.

---

## 8. 옮기실 때 놓치기 쉬운 것들

연속 출석 보너스는 그날 연속 일수가 딱 7일, 14일, 21일, 28일, 30일일 때만 줍니다.
8일째에 또 주면 안 되고, 연속이 끊겼다가 다시 7일을 채우면 그때는 다시 받습니다.

하루 한도는 글을 못 쓰게 막는 게 아닙니다. 한도를 넘겨도 글이랑 댓글은 정상으로 써지고
포인트만 안 붙습니다. 기획서 안내문에도 그렇게 적혀 있습니다.

답글이 달린 댓글은 진짜로 지우면 안 됩니다. \`is_deleted = 1\` 로 표시만 하고 내용을 비워
주세요. 통째로 지우면 남이 달아 놓은 답글까지 같이 사라집니다.

익명으로 쓴 글은 추천을 못 받습니다. 추천 버튼이 눌리지 않고 추천 포인트도 안 붙습니다.

제재된 회원(\`is_banned = 1\`)은 로그인이랑 활동이 막힙니다. 이미 로그인해 있는 상태였어도
바로 끊어 주셔야 합니다.

조회수는 같은 사람이 새로고침해도 한 번만 올라갑니다. 누를 때마다 올리면 숫자가 아무 의미가
없어집니다.

캐릭터 그림 목록은 코드 안에 적어 두지 않았습니다. \`public/avatars/manifest.json\` 에 있고
\`users.avatar_id\` 에는 그 목록의 code 만 들어갑니다. 그래서 나중에 그림이 몇 백 장으로
늘어나도 표 구조는 안 바꾸셔도 됩니다.
`;

// ---- 내보내기 전에 DDL 을 한 번 훑는다 ----------------------------------------
// 한 번은 줄 끝 주석을 쉼표보다 앞에 붙이는 바람에 `--` 가 쉼표까지 삼켜서,
// 문서에 실린 CREATE TABLE 이 통째로 안 도는 상태로 나갈 뻔했다.
// 사람이 눈으로 훑기엔 표가 13개나 되니 여기서 기계가 본다.
{
  const blocks = [...md.matchAll(/```sql\n(CREATE TABLE[\s\S]*?)\n```/g)].map((m) => m[1]);
  const bad = [];
  for (const b of blocks) {
    const name = (b.match(/CREATE TABLE `(\w+)`/) || [])[1] || '?';
    const lines = b.split('\n').slice(1, -1);      // CREATE TABLE ... ( 와 ) ENGINE... 사이
    lines.forEach((l, i) => {
      const code = l.replace(/--.*$/, '').trimEnd(); // 주석을 떼고 본다
      const last = i === lines.length - 1;
      if (!last && !code.endsWith(',')) bad.push(`${name}: 쉼표가 빠졌어요 — ${l.trim()}`);
      if (last && code.endsWith(',')) bad.push(`${name}: 마지막 줄에 쉼표가 남았어요 — ${l.trim()}`);
    });
    const open = (b.match(/\(/g) || []).length;
    const close = (b.match(/\)/g) || []).length;
    if (open !== close) bad.push(`${name}: 괄호 짝이 안 맞아요 (${open} 대 ${close})`);
  }
  if (bad.length) {
    console.error('문서에 실으려던 DDL 이 그대로는 안 돌아요:\n - ' + bad.join('\n - '));
    process.exit(1);
  }
  console.log(`DDL ${blocks.length}개 구문 확인`);
}

fs.writeFileSync(OUT, md);

// ---- 캐릭터 목록을 PHP 배열로도 내보낸다 --------------------------------------
// 캐릭터 225장 + 테두리 9종의 목록은 public/avatars/manifest.json 에 있는데,
// PHP 5.1 에는 json_decode 가 없다(5.2부터). 그래서 같은 내용을 그냥
// PHP 파일로 뽑아 둔다 — include 한 줄이면 배열로 받을 수 있다.
// 대괄호 배열([])도 5.4부터라 array() 로 쓴다.
{
  const items = require('../src/avatars').items();
  const q = (v) => "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  const val = (v) => (v === null || v === undefined ? 'null'
    : typeof v === 'number' ? String(v)
    : typeof v === 'boolean' ? (v ? 'true' : 'false') : q(v));
  const KEYS = ['code', 'kind', 'memberType', 'name', 'theme', 'themeCode',
    'row', 'col', 'free', 'price', 'file', 'thumb'];
  const rows = items.map((it) => '  array('
    + KEYS.filter((k) => it[k] !== undefined).map((k) => `${q(k)} => ${val(it[k])}`).join(', ')
    + '),');
  const php = `<?php
// 캐릭터·테두리 목록 (자동 생성 — node scripts/make-db-spec.js)
//
// public/avatars/manifest.json 과 같은 내용입니다.
// PHP 5.1 에는 json_decode 가 없어서(5.2부터) 배열 그대로 뽑아 뒀습니다.
//
//   $avatars = include 'avatars.php';
//   foreach ($avatars as $a) { echo $a['code'], ' ', $a['name'], "\\n"; }
//
// users.avatar_id · users.border_id · user_items.item_code 에 들어가는 값이 'code' 입니다.
// 그림 파일은 public/avatars/ 아래 'file'(본문) · 'thumb'(썸네일) 이름으로 있습니다.
// 총 ${items.length}개 · 만든 날 ${today}

return array(
${rows.join('\n')}
);
`;
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'avatars.php'), php);
  console.log(`캐릭터 ${items.length}개를 PHP 배열로도 냈어요 → docs/avatars.php`);
}
console.log(`쿼리 ${QUERIES.length}개 실행 확인 · 테이블 ${TABLES.length}개`);
console.log('→ docs/DB명세.md');
