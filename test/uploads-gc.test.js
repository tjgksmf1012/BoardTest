// 고아 업로드 파일 정리 테스트
// 에디터는 사진을 고르는 즉시 올리므로, 글을 등록하지 않고 나가면 파일만 남는다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boardtest-gc-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
fs.mkdirSync(process.env.UPLOAD_DIR, { recursive: true });

const db = require('../src/db');
const { sweepOrphanUploads } = require('../src/uploads-gc');

function makeFile(name, ageMs = 0) {
  const full = path.join(process.env.UPLOAD_DIR, name);
  fs.writeFileSync(full, 'x');
  if (ageMs) {
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(full, t, t);
  }
  return full;
}
const exists = (name) => fs.existsSync(path.join(process.env.UPLOAD_DIR, name));

test('글에 쓰인 사진은 오래돼도 지우지 않는다', () => {
  const userId = db.prepare("INSERT INTO users (username, password_hash, nickname) VALUES ('gcu1','x','정리1')").run().lastInsertRowid;
  const postId = db.prepare("INSERT INTO posts (user_id, title, content) VALUES (?, '글', '내용')").run(userId).lastInsertRowid;
  makeFile('used.png', 24 * 60 * 60 * 1000);
  db.prepare('INSERT INTO post_images (post_id, filename) VALUES (?, ?)').run(postId, 'used.png');

  sweepOrphanUploads({ minAgeMs: 0 });
  assert.ok(exists('used.png'), '글에 연결된 파일은 남아야 한다');
});

test('어느 글에도 없고 오래된 파일은 지운다', () => {
  makeFile('orphan-old.png', 24 * 60 * 60 * 1000);
  const r = sweepOrphanUploads(); // 기본 6시간 기준
  assert.ok(!exists('orphan-old.png'), '오래된 고아 파일은 지워져야 한다');
  assert.ok(r.removed >= 1);
});

test('방금 올린 파일은 아직 작성 중일 수 있으므로 남긴다', () => {
  makeFile('orphan-new.png'); // 지금 막 올림
  sweepOrphanUploads();       // 기본 6시간 기준
  assert.ok(exists('orphan-new.png'), '작성 중인 글의 사진을 지우면 안 된다');
});
