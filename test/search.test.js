// 전문검색(FTS5) 바이그램 색인 테스트
// 핵심: 한글은 붙여 쓰기 때문에 "주말알바" 안의 "알바"도 찾아야 한다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'boardtest-fts-')), 'test.db');

const db = require('../src/db');
const { bigrams, toMatchQuery, indexPost, unindexPost, rebuildMissing } = require('../src/search');

const userId = db.prepare(
  "INSERT INTO users (username, password_hash, nickname) VALUES ('fts','x','검색이')"
).run().lastInsertRowid;

function addPost(title, text) {
  const id = db.prepare(
    'INSERT INTO posts (user_id, title, content, content_text) VALUES (?, ?, ?, ?)'
  ).run(userId, title, text, text).lastInsertRowid;
  indexPost(id, title, text);
  return id;
}
// 색인으로 후보를 좁힌 뒤 실제 문자열을 대조하는, 실제 목록 화면과 같은 방식
function search(q) {
  const m = toMatchQuery(q);
  const like = `%${q.replace(/[\\%_]/g, (x) => '\\' + x)}%`;
  const sql = m
    ? `SELECT id FROM posts WHERE id IN (SELECT rowid FROM posts_fts WHERE g MATCH @m)
       AND (title LIKE @like ESCAPE '\\' OR content_text LIKE @like ESCAPE '\\')`
    : `SELECT id FROM posts WHERE (title LIKE @like ESCAPE '\\' OR content_text LIKE @like ESCAPE '\\')`;
  return db.prepare(sql).all({ m, like }).map((r) => r.id);
}

test('두 글자씩 잘라 색인한다', () => {
  assert.deepEqual(bigrams('주말알바'), ['주말', '말알', '알바']);
  assert.deepEqual(bigrams('a b'), []); // 공백을 걸친 조각은 버린다
  assert.equal(toMatchQuery('알바'), '"알바"');
  assert.equal(toMatchQuery('주말알바'), '"주말" AND "말알" AND "알바"');
  assert.equal(toMatchQuery('한'), null, '한 글자는 색인으로 좁힐 수 없다');
});

test('붙여 쓴 말 안에서도 찾는다 (한글 검색의 핵심)', () => {
  const a = addPost('주말알바 급구', '주말에만 일할 사람 찾습니다');
  const b = addPost('알바 후기', '카페에서 일한 후기예요');
  const c = addPost('편의점 야간', '야간 근무 이야기');

  const found = search('알바');
  assert.ok(found.includes(a), '"주말알바"처럼 붙여 쓴 말도 찾아야 한다');
  assert.ok(found.includes(b));
  assert.ok(!found.includes(c));
});

test('제목과 본문 어느 쪽이든 찾는다', () => {
  const t = addPost('제목에만 있는 낱말 딸기라떼', '본문은 평범합니다');
  const c = addPost('평범한 제목', '본문에만 있는 낱말 수박주스');
  assert.ok(search('딸기라떼').includes(t));
  assert.ok(search('수박주스').includes(c));
});

test('없는 말은 아무것도 찾지 않는다', () => {
  assert.deepEqual(search('존재하지않는낱말zzz'), []);
});

test('색인이 실제 글자와 어긋나지 않는다 (오탐 걸러내기)', () => {
  // "가나"와 "나다"가 각각 들어간 글은 "가나다"로 검색되면 안 된다
  const split = addPost('가나 그리고 나다', '조각은 있지만 이어지진 않아요');
  const whole = addPost('가나다 완성', '이어진 낱말');
  const found = search('가나다');
  assert.ok(found.includes(whole));
  assert.ok(!found.includes(split), '조각만 맞고 실제로는 없는 글은 빠져야 한다');
});

test('글을 고치면 색인도 따라 바뀐다', () => {
  const id = addPost('원래 제목 파인애플', '원래 본문');
  assert.ok(search('파인애플').includes(id));

  db.prepare('UPDATE posts SET title = ?, content_text = ? WHERE id = ?')
    .run('바뀐 제목 망고스틴', '바뀐 본문', id);
  indexPost(id, '바뀐 제목 망고스틴', '바뀐 본문');

  assert.ok(!search('파인애플').includes(id), '옛 낱말로는 더 이상 찾히면 안 된다');
  assert.ok(search('망고스틴').includes(id));
});

test('글을 지우면 색인에서도 빠진다', () => {
  const id = addPost('사라질 글 블루베리', '내용');
  assert.ok(search('블루베리').includes(id));
  db.prepare('DELETE FROM posts WHERE id = ?').run(id);
  unindexPost(id);
  assert.deepEqual(search('블루베리'), []);
});

test('색인이 없는 옛 글도 기동 때 채워진다', () => {
  const id = db.prepare(
    'INSERT INTO posts (user_id, title, content, content_text) VALUES (?, ?, ?, ?)'
  ).run(userId, '색인 없이 들어간 글 자몽에이드', '내용', '내용').lastInsertRowid;
  assert.deepEqual(search('자몽에이드'), [], '아직은 못 찾는다');

  const n = rebuildMissing();
  assert.ok(n >= 1);
  assert.ok(search('자몽에이드').includes(id), '채운 뒤에는 찾아야 한다');
});
