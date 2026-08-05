#!/usr/bin/env node
// 이식용/원본소스/ 를 다시 채운다 — 선배님이 "이 값은 어떻게 계산하나" 볼 때 보시는 것
//
//   node scripts/make-port-src.js
//   node scripts/make-port-src.js --check   다시 채우지 않고 낡았는지만 본다
//
// 왜 만들었나
//   이 폴더도 손으로 모았다. 그래서 파일을 새로 만들면 여기에는 안 들어가고,
//   고쳐도 안 따라온다. 실제로 test/port-parity.test.js 와 scripts/make-screens.js 가
//   빠져 있었다. 화면HTML 이 낡았던 것과 같은 종류의 문제다.
//
// 뭘 넣고 뭘 뺐나
//   넣는 것 — 프로그램이 도는 데 필요한 것과, 무엇을 어떻게 확인했는지 보여 주는 것
//   빼는 것 — 만들어진 결과물(PDF·HTML), 그림 492장(이식용/img 에 이미 있다),
//             임시 폴더(data·uploads·node_modules)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEST = path.join(ROOT, '이식용/원본소스');
const CHECK = process.argv.includes('--check');

// 통째로 옮길 폴더
const DIRS = ['src', 'test', 'views', 'api', 'scripts'];

// 낱개로 옮길 파일
const FILES = ['server.js', 'package.json', 'README.md', '실행방법.md', '배포방법.md'];

// docs 는 다 넣으면 PDF 까지 딸려 가서 무거워진다. 읽으실 것만 고른다.
const DOCS = ['DESIGN.md', 'DB명세.md', '연동가이드.md', '테스트계획.md', '시안대조표.md'];

// 화면 모양을 정하는 CSS 는 원본도 같이 드린다 (이식용/화면/cm.css 의 원본이다)
const EXTRA = [['public/css/style.css', 'public/css/style.css']];

// 옮기지 않을 것
const SKIP = /(^|\/)(node_modules|data|uploads|\.git)(\/|$)/;

function walk(dir, base = dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(ROOT, full);
    if (SKIP.test(rel)) continue;
    if (fs.statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(rel);
  }
  return out;
}

// 옮길 것 목록을 만든다
const wanted = [];
for (const d of DIRS) {
  const full = path.join(ROOT, d);
  if (fs.existsSync(full)) wanted.push(...walk(full));
}
for (const f of FILES) if (fs.existsSync(path.join(ROOT, f))) wanted.push(f);
for (const d of DOCS) if (fs.existsSync(path.join(ROOT, 'docs', d))) wanted.push('docs/' + d);
for (const [src] of EXTRA) if (fs.existsSync(path.join(ROOT, src))) wanted.push(src);

// 지금 들어 있는 것
function listDest() {
  if (!fs.existsSync(DEST)) return [];
  const out = [];
  const rec = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) rec(full);
      else out.push(path.relative(DEST, full));
    }
  };
  rec(DEST);
  return out;
};
const have = listDest();

const missing = wanted.filter((f) => !have.includes(f));
const extra = have.filter((f) => !wanted.includes(f));
const changed = wanted.filter((f) => have.includes(f)
  && !fs.readFileSync(path.join(ROOT, f)).equals(fs.readFileSync(path.join(DEST, f))));

if (CHECK) {
  const bad = missing.length + extra.length + changed.length;
  if (missing.length) console.error(`빠진 파일 ${missing.length}개: ${missing.slice(0, 6).join(', ')}`);
  if (changed.length) console.error(`낡은 파일 ${changed.length}개: ${changed.slice(0, 6).join(', ')}`);
  if (extra.length) console.error(`이제 없는 파일 ${extra.length}개: ${extra.slice(0, 6).join(', ')}`);
  if (bad) {
    console.error('node scripts/make-port-src.js 로 다시 채워 주세요.');
    process.exit(1);
  }
  console.log(`원본소스 ${wanted.length}개 파일 · 지금 코드와 같습니다`);
} else {
  for (const f of missing.concat(changed)) {
    const to = path.join(DEST, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), to);
  }
  for (const f of extra) fs.rmSync(path.join(DEST, f), { force: true });
  console.log(`원본소스를 다시 채웠어요 — 파일 ${wanted.length}개`
    + ` (새로 ${missing.length} · 갱신 ${changed.length} · 삭제 ${extra.length})`);
}
