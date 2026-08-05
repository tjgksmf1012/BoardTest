#!/usr/bin/env node
// 선배님께 드리는 PHP 파일이 PHP 5.1 에서 도는지 확인한다
//
//   node scripts/check-php51.js
//
// 옮겨 갈 서버가 PHP 5.1 이라, 우리가 만들어 드리는 PHP 파일에 그보다 나중 문법이나
// 나중 함수가 섞이면 서버에서 흰 화면만 뜨고 이유를 알기 어렵다.
// 여기서 걸러 두면 파일을 보내기 전에 알 수 있다.
//
// 이 검사는 '문법을 흉내 내어 훑는' 수준이다. PHP 실행기가 없어서 진짜로 돌려 보지는
// 못한다. 그래서 확실히 5.2 이상인 것만 잡고, 애매한 것은 그냥 둔다.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGETS = [
  'docs/avatars.php',
  'docs/check-server.php',
  '이식용/캐릭터목록.php',
  '이식용/lib/cm_config.php',
  '이식용/lib/cm_db.php',
  '이식용/lib/cm_points.php',
  '이식용/lib/cm_attendance.php',
  '이식용/lib/cm_avatar.php',
];

// 문자열·주석 안의 내용은 문법이 아니다. 대충이라도 걷어내고 본다.
function stripStringsAndComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (two === '//' || c === '#') {                    // 한 줄 주석
      const nl = src.indexOf('\n', i);
      i = nl < 0 ? src.length : nl;
      continue;
    }
    if (two === '/*') {                                  // 여러 줄 주석
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (c === "'" || c === '"') {                        // 따옴표 안
      const quote = c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        i++;
      }
      out += ' ';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// 확실히 PHP 5.2 이상에서만 되는 것들
const RULES = [
  { re: /(=|=>|\(|,|return)\s*\[/, what: '대괄호 배열 [ ]', since: 'PHP 5.4', fix: 'array() 로' },
  { re: /\bfunction\s*\(/, what: '익명 함수(클로저)', since: 'PHP 5.3', fix: '이름 있는 함수로' },
  { re: /\bfn\s*\(/, what: '화살표 함수 fn()', since: 'PHP 7.4', fix: '이름 있는 함수로' },
  { re: /\?\?/, what: '?? 연산자', since: 'PHP 7.0', fix: 'isset() 로' },
  { re: /\?->/, what: '?-> 연산자', since: 'PHP 8.0', fix: '-> 와 isset() 로' },
  { re: /<=>/, what: '<=> 연산자', since: 'PHP 7.0', fix: '비교 두 번으로' },
  { re: /\bnamespace\s+\w/, what: '네임스페이스', since: 'PHP 5.3', fix: '이름 앞에 접두사로' },
  { re: /\b__DIR__\b/, what: '__DIR__', since: 'PHP 5.3', fix: 'dirname(__FILE__) 로' },
  { re: /\bstatic::/, what: 'static:: (늦은 정적 바인딩)', since: 'PHP 5.3', fix: 'self:: 로' },
  { re: /\bgoto\b/, what: 'goto', since: 'PHP 5.3', fix: '쓰지 않기' },
  { re: /<<<'/, what: 'nowdoc <<<\'', since: 'PHP 5.3', fix: '작은따옴표 문자열로' },
  { re: /\bjson_(encode|decode)\s*\(/, what: 'json_encode / json_decode', since: 'PHP 5.2', fix: 'docs/avatars.php 처럼 배열로 두기' },
  { re: /\bnew\s+DateTime\b|\bdate_create\s*\(/, what: 'DateTime', since: 'PHP 5.2', fix: 'strtotime() · date() 로' },
  { re: /\bpassword_(hash|verify)\s*\(/, what: 'password_hash / password_verify', since: 'PHP 5.5', fix: '연동 모드면 비밀번호가 없습니다' },
  { re: /\bsys_get_temp_dir\s*\(/, what: 'sys_get_temp_dir()', since: 'PHP 5.2.1', fix: '경로를 직접 적기' },
  { re: /\barray_fill_keys\s*\(/, what: 'array_fill_keys()', since: 'PHP 5.2', fix: 'foreach 로' },
  { re: /\blcfirst\s*\(/, what: 'lcfirst()', since: 'PHP 5.3', fix: 'strtolower(substr(...)) 로' },
  { re: /\bstr_getcsv\s*\(/, what: 'str_getcsv()', since: 'PHP 5.3', fix: 'explode() 로' },
  { re: /\[\s*['"]?\w*['"]?\s*\]\s*=\s*\[/, what: '중첩 대괄호 배열', since: 'PHP 5.4', fix: 'array() 로' },
];

// json_decode 는 '없다' 고 안내하는 자리에서는 글로 나올 수 있다.
// 문자열·주석을 걷어낸 뒤에 보므로, 실제로 호출하는 것만 걸린다.

let bad = 0;
let checked = 0;
for (const rel of TARGETS) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) { console.log(`  - ${rel}: 없음 (건너뜀)`); continue; }
  const raw = fs.readFileSync(file, 'utf8');
  const code = stripStringsAndComments(raw);
  checked++;

  const hits = [];
  for (const r of RULES) {
    // 줄 번호를 알려 주려고 줄 단위로 다시 본다
    code.split('\n').forEach((line, i) => {
      if (r.re.test(line)) hits.push(`${i + 1}줄: ${r.what} (${r.since} 부터) — ${r.fix}`);
    });
  }
  // 여는 태그가 없으면 그냥 텍스트 파일이다
  if (!raw.trimStart().startsWith('<?php')) hits.push('1줄: <?php 로 시작하지 않습니다');

  if (hits.length) {
    console.log(`\n✗ ${rel}`);
    for (const h of hits) console.log(`    ${h}`);
    bad += hits.length;
  } else {
    console.log(`✓ ${rel}`);
  }
}

console.log(`\nPHP 파일 ${checked}개 확인 · 걸린 것 ${bad}건`);
if (bad) {
  console.error('PHP 5.1 서버에서는 이 파일이 안 돕니다.');
  process.exit(1);
}
process.exit(0);
