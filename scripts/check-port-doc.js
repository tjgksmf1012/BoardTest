#!/usr/bin/env node
// 이식용/README.md 에 적힌 숫자가 실제와 맞는지
//
//   node scripts/check-port-doc.js
//
// 왜 만들었나
//   드리는 꾸러미에서 선배님이 제일 먼저 읽는 글이 이 README 다.
//   그런데 여기에는 '검사 88가지', '캐릭터 246종', '그림 492장' 처럼 숫자가 여럿 박혀 있다.
//   코드가 늘어도 이 글은 저절로 안 따라온다.
//
//   실제로 드리기 직전에 보니 '81가지' · 'run.php 38가지' 로 적혀 있었다. 진짜는 88과 45였다.
//   받는 쪽에서는 확인할 길이 없다 — 돌려 보고 숫자가 다르면 뭐가 빠진 건가 의심하게 된다.
//
//   그래서 세어 보고 대조한다. PHP 검사는 실제로 돌려서 결과를 읽는다.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const 이식용 = path.join(ROOT, '이식용');
const README = fs.readFileSync(path.join(이식용, 'README.md'), 'utf8');

const 틀린것 = [];
const 본것 = [];

// 글에 적힌 그 숫자가 전부 실제와 같은지.
//
// 처음에는 '맞는 게 하나라도 있나' 로 봤는데, 그러면 안 된다.
// 같은 숫자가 글에 두 번 나오는 것들이 있어서(그림 장수가 그렇다),
// 한 곳만 틀리게 고쳐도 나머지 한 곳이 맞으면 그냥 통과해 버렸다.
// 되돌려서 재 보고 알았다 — 검사가 헛돌고 있었다.
// 그래서 나오는 자리를 **전부** 찾아서 하나라도 다르면 걸리게 한다.
function 봐야한다(무엇, 실제, 무늬) {
  const 아무숫자 = new RegExp(무늬.replace('N', '(\\d+)'), 'g');
  const 나온것 = [...README.matchAll(아무숫자)].map((m) => Number(m[1]));
  if (!나온것.length) { 틀린것.push(`${무엇}: 실제 ${실제} · 글에 아예 없음`); return; }
  const 다른것 = 나온것.filter((n) => n !== 실제);
  if (다른것.length) {
    틀린것.push(`${무엇}: 실제 ${실제} · 글에는 ${[...new Set(다른것)].join(', ')}`
      + (나온것.length > 1 ? ` (${나온것.length}군데 중 ${다른것.length}군데)` : ''));
    return;
  }
  본것.push(`${무엇} ${실제}${나온것.length > 1 ? `×${나온것.length}` : ''}`);
}

// ---- PHP 검사 개수 — 실제로 돌려서 읽는다 ------------------------------------
let phpOK = true;
function php검사(파일) {
  try {
    const out = execFileSync('php', [path.join('test', 파일)],
      { cwd: 이식용, encoding: 'utf8' });
    const m = out.match(/확인 (\d+)개/);
    if (!m) throw new Error('결과에서 개수를 못 찾음');
    return Number(m[1]);
  } catch (e) {
    phpOK = false;
    return null;
  }
}
const run = php검사('run.php');
const render = php검사('render.php');
if (phpOK && run !== null && render !== null) {
  봐야한다('run.php 검사 수', run, 'php test/run\\.php      함수가 맞게 도는지 \\(N가지\\)');
  봐야한다('run.php 설명', run, '`run\\.php` 는 N가지를 확인합니다');
  봐야한다('render.php 검사 수', render, 'php test/render\\.php   화면 세 개가 실제로 그려지는지 \\(N가지\\)');
  봐야한다('둘 합친 수', run + render, 'N가지를 자동으로 확인해 드립니다');
} else {
  console.log('※ PHP 가 없어서 검사 개수는 못 봤습니다 (나머지는 봤습니다)');
}

// ---- 세어서 알 수 있는 것들 ----------------------------------------------------
const 캐릭터목록 = fs.readFileSync(path.join(이식용, '캐릭터목록.php'), 'utf8');
const 종수 = (캐릭터목록.match(/'code'\s*=>/g) || []).length;
봐야한다('캐릭터 종수', 종수, '캐릭터 N종의 이름과 값');

const 그림 = fs.readdirSync(path.join(이식용, 'img', 'avatars')).filter((f) => f.endsWith('.png'));
봐야한다('그림 장수', 그림.length, '그림 N장');

const 화면HTML = fs.readdirSync(path.join(이식용, '화면HTML')).filter((f) => f.endsWith('.html'));
봐야한다('화면HTML 개수', 화면HTML.length, '화면 N개를 HTML 로 뽑아 둔 것');

const libPHP = fs.readdirSync(path.join(이식용, 'lib')).filter((f) => f.endsWith('.php'));
const 한글수 = { 1: '한', 2: '두', 3: '세', 4: '네', 5: '다섯', 6: '여섯', 7: '일곱' };
if (!new RegExp(`화면 뒤에서 도는 PHP ${한글수[libPHP.length]} ?개`).test(README)) {
  틀린것.push(`lib PHP 개수: 실제 ${libPHP.length}개(${한글수[libPHP.length]})`
    + ' · 글과 다릅니다');
} else 본것.push(`lib PHP ${libPHP.length}`);

// ---- 결과 --------------------------------------------------------------------
console.log('');
if (틀린것.length) {
  console.error('이식용/README.md 의 숫자가 실제와 다릅니다:');
  for (const x of 틀린것) console.error('  ✗ ' + x);
  console.error('\n선배님이 제일 먼저 읽는 글입니다. 숫자를 맞춰 주세요.');
  process.exit(1);
}
console.log(`이식용/README.md 숫자 ${본것.length}가지 · 실제와 같습니다`);
console.log('  ' + 본것.join(' · '));
