// 전문검색(FTS5) — 한글에 맞춘 바이그램(2글자) 색인
//
// 왜 이렇게 하나:
//  - 기존 `LIKE '%검색어%'`는 앞에 와일드카드가 있어 인덱스를 못 타고 매번 전체를 훑는다.
//  - FTS5 기본 토크나이저(unicode61)는 띄어쓰기로 단어를 나눠서, 한글처럼 붙여 쓰는 말은
//    "주말알바"에서 "알바"를 찾지 못한다.
//  - FTS5 trigram 토크나이저는 부분일치가 되지만 3글자 이상만 매칭돼서
//    "알바", "카페" 같은 두 글자 검색이 통째로 안 된다.
//  → 본문을 두 글자씩 잘라 토큰으로 저장하면, 두 글자 검색부터 부분일치가 모두 된다.
//    (검색어도 같은 방식으로 잘라 AND로 묶는다. 드물게 생기는 오탐은 원문 대조로 걸러낸다.)
const db = require('./db');

// FTS5 검색어에서 특수문자를 없앤 뒤 두 글자씩 자른다
function bigrams(text) {
  const t = String(text || '').replace(/\s+/g, ' ').toLowerCase();
  const out = [];
  for (let i = 0; i < t.length - 1; i += 1) {
    const g = t.slice(i, i + 2);
    if (!/\s/.test(g) && !/["'*()]/.test(g)) out.push(g);
  }
  return out;
}

// 색인에 넣을 문자열 (제목 + 본문 평문)
function indexText(title, text) {
  return bigrams(`${title || ''} ${text || ''}`).join(' ');
}

// 검색어를 FTS5 질의로 (모든 조각을 다 포함하는 글만)
function toMatchQuery(q) {
  const gs = bigrams(q);
  if (gs.length === 0) return null; // 한 글자 검색은 FTS로 못 좁힌다
  return gs.map((g) => `"${g}"`).join(' AND ');
}

const insertStmt = () => db.prepare('INSERT OR REPLACE INTO posts_fts(rowid, g) VALUES (?, ?)');
const deleteStmt = () => db.prepare('DELETE FROM posts_fts WHERE rowid = ?');

// 글이 새로 생기거나 내용이 바뀔 때 색인을 갱신한다
function indexPost(postId, title, text) {
  insertStmt().run(postId, indexText(title, text));
}
function unindexPost(postId) {
  deleteStmt().run(postId);
}

// 아직 색인되지 않은 글을 채워 넣는다 (기존 DB·데모 데이터용)
function rebuildMissing() {
  const rows = db.prepare(`
    SELECT p.id, p.title, COALESCE(p.content_text, p.content) AS text
    FROM posts p LEFT JOIN posts_fts f ON f.rowid = p.id
    WHERE f.rowid IS NULL`).all();
  if (rows.length === 0) return 0;
  const ins = insertStmt();
  db.transaction(() => rows.forEach((r) => ins.run(r.id, indexText(r.title, r.text))))();
  return rows.length;
}

module.exports = { bigrams, indexText, toMatchQuery, indexPost, unindexPost, rebuildMissing };
