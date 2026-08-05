#!/usr/bin/env node
// 이식용 화면에 쓸 CSS 를 만든다 — 선배님 사이트 CSS 와 안 부딪히게 가둔다
//
//   node scripts/make-port-css.js
//
// 왜 필요한가
//   우리 style.css 에는 `body`, `*`, `.card` 같은 흔한 이름이 그대로 들어 있다.
//   이걸 기존 사이트에 그냥 올리면 그쪽 화면까지 같이 바뀐다. 남의 사이트를 망가뜨리는 것이다.
//   그래서 선택자마다 앞에 `.cm` 을 붙여, `<div class="cm">` 안에서만 듣게 만든다.
//
//   :root 는 그대로 두면 문서 전체에 색 변수를 뿌리므로 `.cm` 으로 바꾼다.
//   body · html · * 도 마찬가지로 `.cm` 안쪽으로 좁힌다.
//   @keyframes 는 선택자가 아니라 건드리지 않는다.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, '이식용/화면HTML/css/style.css');
const OUT = path.join(ROOT, '이식용/화면/cm.css');

const WRAP = '.cm';

// 선택자 하나를 가둔다
function scopeOne(sel) {
  let s = sel.trim();
  if (!s) return s;
  if (s.startsWith('@')) return s;                  // @media 등은 위에서 따로 본다
  if (s.startsWith('from') || s.startsWith('to') || /^\d+%$/.test(s)) return s;  // keyframes 안
  if (s.startsWith(WRAP)) return s;                 // 이미 가둔 것

  // :root 계열 — 문서 전체가 아니라 우리 상자에 건다
  s = s.replace(/^:root\b/, WRAP);
  if (s.startsWith(WRAP)) return s;

  // html · body · * 는 우리 상자 자신으로 바꾼다
  if (s === 'html' || s === 'body' || s === '*') return s === '*' ? WRAP + ' *' : WRAP;
  s = s.replace(/^(html|body)\s+/, '');
  s = s.replace(/^(html|body)(?=[.:#\[])/, '');

  return WRAP + ' ' + s;
}

function scopeSelector(list) {
  return list.split(',').map(scopeOne).join(', ');
}

// 중괄호를 세어 가며 규칙 단위로 훑는다.
// 정규식 한 방으로 하려다 @media 안쪽을 놓쳐서, 그냥 한 글자씩 읽기로 했다.
function scope(css) {
  let out = '';
  let i = 0;
  let buf = '';
  const stack = [];        // 'keyframes' 안에서는 선택자를 안 건드린다

  while (i < css.length) {
    const c = css[i];

    if (css.startsWith('/*', i)) {                  // 주석은 그대로 옮긴다
      const end = css.indexOf('*/', i + 2);
      const stop = end < 0 ? css.length : end + 2;
      out += buf + css.slice(i, stop);              // 앞에 모아 둔 줄바꿈·들여쓰기를 먼저 흘린다
      buf = '';
      i = stop;
      continue;
    }

    if (c === '{') {
      const head = buf.trim();
      const inKeyframes = stack.indexOf('keyframes') >= 0;
      if (/^@(media|supports)/.test(head)) {
        stack.push('media');
        out += buf + '{';
      } else if (/^@keyframes|^@-\w+-keyframes/.test(head)) {
        stack.push('keyframes');
        out += buf + '{';
      } else if (/^@/.test(head)) {
        stack.push('at');
        out += buf + '{';
      } else {
        stack.push('rule');
        const lead = buf.match(/^\s*/)[0];
        out += lead + (inKeyframes ? head : scopeSelector(head)) + ' {';
      }
      buf = '';
      i++;
      continue;
    }

    if (c === '}') {
      out += buf + '}';
      buf = '';
      stack.pop();
      i++;
      continue;
    }

    buf += c;
    i++;
  }
  return out + buf;
}

const src = fs.readFileSync(SRC, 'utf8');
const scoped = scope(src);

// 확인 — 가두지 못한 선택자가 남아 있으면 알린다
const leaked = [];
{
  const bodies = scoped.replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0, head = '';
  const stack = [];
  for (let i = 0; i < bodies.length; i++) {
    const c = bodies[i];
    if (c === '{') {
      const h = head.trim();
      const at = /^@/.test(h);
      const inKf = stack.indexOf('keyframes') >= 0;
      stack.push(/^@keyframes|^@-\w+-keyframes/.test(h) ? 'keyframes' : at ? 'at' : 'rule');
      if (!at && !inKf) {
        for (const s of h.split(',')) {
          const t = s.trim();
          if (t && !t.startsWith(WRAP)) leaked.push(t);
        }
      }
      head = '';
      depth++;
    } else if (c === '}') { stack.pop(); head = ''; depth--; }
    else if (depth === 0 || stack[stack.length - 1] !== 'rule') head += c;
    else head = '';
  }
}

const banner = `/* 이식용 화면 CSS — 자동 생성 (node scripts/make-port-css.js)
 *
 * 선택자마다 앞에 .cm 이 붙어 있습니다.
 * 그래서 <div class="cm"> 안쪽에만 듣고, 기존 사이트 화면은 건드리지 않습니다.
 * 색을 바꾸시려면 맨 위 .cm { --primary: ... } 값만 고치시면 전체가 따라 바뀝니다.
 */
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, banner + scoped);

const rules = (scoped.match(/\{/g) || []).length;
console.log(`규칙 ${rules}개를 .cm 안으로 가뒀어요 → 이식용/화면/cm.css`);
if (leaked.length) {
  console.error(`\n못 가둔 선택자 ${leaked.length}개:`);
  for (const l of [...new Set(leaked)].slice(0, 20)) console.error('  ' + l);
  process.exit(1);
}
console.log('밖으로 새는 선택자 없음');
