// 고아 업로드 파일 정리
//
// 에디터는 사진을 고르는 즉시 서버에 올린다. 그래서 글을 끝내 등록하지 않고 나가면
// 어느 글에도 속하지 않는 파일이 디스크에 남는다. 그대로 두면 계속 쌓이므로,
// "충분히 오래됐고(작성 중일 리 없고) 어떤 글에도 연결되지 않은" 파일만 지운다.
const fs = require('fs');
const path = require('path');
const db = require('./db');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const MIN_AGE_MS = 6 * 60 * 60 * 1000; // 6시간 (작성 중인 글의 사진을 지우지 않도록 넉넉히)

function sweepOrphanUploads({ minAgeMs = MIN_AGE_MS } = {}) {
  let files = [];
  try { files = fs.readdirSync(UPLOAD_DIR); } catch { return { removed: 0, kept: 0 }; }

  const used = new Set(db.prepare('SELECT filename FROM post_images').all().map((r) => r.filename));
  const now = Date.now();
  let removed = 0;
  let kept = 0;

  for (const name of files) {
    if (used.has(name)) { kept += 1; continue; }
    const full = path.join(UPLOAD_DIR, name);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (!stat.isFile()) continue;
    if (now - stat.mtimeMs < minAgeMs) { kept += 1; continue; } // 아직 작성 중일 수 있음
    try { fs.rmSync(full, { force: true }); removed += 1; } catch { /* 다음 번에 다시 시도 */ }
  }
  return { removed, kept };
}

// 서버가 떠 있는 동안 주기적으로 청소 (기동 직후 1회 + 6시간마다)
function startUploadsGc() {
  const run = () => {
    const { removed } = sweepOrphanUploads();
    if (removed > 0) console.log(`사용되지 않는 업로드 파일 ${removed}개를 정리했어요.`);
  };
  run();
  const timer = setInterval(run, 6 * 60 * 60 * 1000);
  timer.unref(); // 테스트가 이 타이머 때문에 끝나지 않는 일이 없도록
  return timer;
}

module.exports = { sweepOrphanUploads, startUploadsGc };
