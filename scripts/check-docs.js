#!/usr/bin/env node
// 인수인계 문서가 사람이 쓴 것처럼 읽히는지 재 본다
//
//   node scripts/check-docs.js
//   node scripts/check-docs.js --old      (고치기 전과 비교)
//
// 왜 만들었나
//   "AI 가 쓴 것 같다" 는 말은 감이라 고치고 나서도 나아졌는지 알 수가 없다.
//   그래서 티가 나는 버릇 몇 가지를 숫자로 재기로 했다.
//   이건 점수가 아니라 냄새다. 걸렸다고 다 틀린 것도, 안 걸렸다고 다 좋은 것도 아니다.
//   다만 '한 군데도 안 걸리는데 읽기 나쁜 글' 보다는 '걸린 데를 가서 보는' 편이 낫다.
//
// 재는 것
//   1. 문장 길이가 다 똑같은가        사람은 들쭉날쭉하다. 고르면 기계 냄새가 난다
//   2. 문단 길이가 다 똑같은가        위와 같은 이유
//   3. 굵게 표시를 몇 번이나 했나      아무 데나 굵게 하면 아무것도 안 굵은 것과 같다
//   4. 줄표(—) 를 몇 번 썼나          사람은 이 문장부호를 잘 안 쓴다
//   5. 사람 흔적이 있나               '제가', '저희가 ~하다가 틀렸습니다' 같은 것
//   6. 구체적인가                     숫자·파일명·버전이 없으면 다 맞는 말만 한 것이다
//   7. 접속어로 문장을 시작하는가      또한/따라서/즉 로 시작하는 문장이 많으면 늘어진다
//   8. 표를 잘못 쓰고 있나            (아래 설명)
//
// 8번이 이번에 제일 쓸모 있었다.
//   표에는 두 종류가 있다.
//     찾아보는 표  칸이 짧다. 눈이 뛰어서 원하는 줄을 찾는다. 이건 표가 맞다
//     접어 둔 표  칸이 길다. 원래 문장인데 표에 욱여넣은 것이다. 이건 펴야 한다
//   반대로 문장 하나에 `코드` 가 서너 개씩 나열돼 있으면 그건 표를 문장으로 뭉갠 것이다.
//   양쪽 다 잡는다.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TARGETS = [
  '이식용/README.md',
  'docs/연동가이드.md',
  'docs/DB명세.md',
  'docs/확인요청사항.md',
  '실행방법.md',
  '배포방법.md',
];

// 코드 블록은 글이 아니다. 빼고 본다.
function stripCode(md) {
  return md.replace(/```[\s\S]*?```/g, '\n');
}

function cv(nums) {                       // 변동계수. 클수록 들쭉날쭉하다
  if (nums.length < 2) return 0;
  const m = nums.reduce((a, b) => a + b, 0) / nums.length;
  if (m === 0) return 0;
  const v = nums.reduce((a, b) => a + (b - m) ** 2, 0) / nums.length;
  return Math.sqrt(v) / m;
}

function measure(md) {
  const body = stripCode(md);
  const chars = body.replace(/\s/g, '').length || 1;
  const per1k = (n) => +(n / chars * 1000).toFixed(1);

  // 문장 — 표와 목록 기호는 문장이 아니므로 뺀다
  const prose = body.split('\n')
    .filter((l) => !/^\s*[|#>]/.test(l) && !/^\s*[-*]\s/.test(l) && !/^\s*\d+\.\s/.test(l))
    .join(' ');
  const sentences = prose.split(/(?<=[.!?다요]\s)|\n/)
    .map((s) => s.trim()).filter((s) => s.length > 10);

  // 문단.
  // 번호 목록은 한 덩어리가 아니라 항목마다 하나로 센다.
  // 처음엔 안 그랬더니 '배포 5단계' 전체가 문단 하나로 잡혀서 엉뚱하게 걸렸다.
  const paras = body.split(/\n\s*\n/)
    .flatMap((p) => p.split(/\n(?=\s*(?:\d+\.|[-*])\s)/))
    .map((p) => p.trim()).filter((p) => p && !/^[|#]/.test(p));

  // 표를 두 종류로 가른다
  const tables = [];
  {
    const lines = body.split('\n');
    let cur = null;
    for (const l of lines) {
      if (/^\s*\|/.test(l)) {
        if (!cur) cur = [];
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(l)) cur.push(l);
      } else if (cur) { tables.push(cur); cur = null; }
    }
    if (cur) tables.push(cur);
  }
  const tableInfo = tables.filter((t) => t.length >= 2).map((t) => {
    const cells = [];
    for (const row of t.slice(1)) {                     // 머리줄은 뺀다
      for (const c of row.split('|').slice(1, -1)) {
        const s = c.trim().replace(/`[^`]*`/g, 'X').replace(/\*\*/g, '');
        if (s) cells.push(s.length);
      }
    }
    const avg = cells.length ? cells.reduce((a, b) => a + b, 0) / cells.length : 0;
    return { rows: t.length - 1, avgCell: +avg.toFixed(1), first: t[0].trim().slice(0, 40) };
  });

  // 문장에 `코드` 가 서너 개 박혀 있으면 찾아보는 표를 문장으로 뭉갠 것일 수 있다.
  //
  // 처음에는 '코드 3개 이상' 만으로 걸렀는데 오탐이 너무 많았다.
  // MySQL 버전 설명처럼 코드가 여럿 나올 뿐 멀쩡한 설명문이 다 걸렸다.
  // 진짜 뭉갠 표에는 표시가 하나 더 있다 — 나열된 것들이 생김새가 같다.
  //   `원본소스/src/routes/board.js` `원본소스/src/points.js` `원본소스/src/avatars.js`
  // 앞이 똑같다. 이건 표의 한 칸씩이 문장에 실려 온 것이다.
  // 그래서 '앞이 겹치는 게 3개 이상' 일 때만 센다.
  //
  // 그래도 완전하지는 않아서 결론을 내리지 않고 '가서 보세요' 로만 알린다.
  const smothered = [];
  for (const p of paras) {
    if (/^[-*|]/.test(p) || p.length <= 80) continue;
    const spans = (p.match(/`[^`]+`/g) || []).map((s) => s.slice(1, -1));
    if (spans.length < 3) continue;
    // 앞 4글자가 같은 것끼리 묶어 본다
    const groups = {};
    for (const s of spans) {
      const k = s.slice(0, 4);
      if (k.length < 4) continue;
      groups[k] = (groups[k] || 0) + 1;
    }
    const biggest = Math.max(0, ...Object.values(groups));
    if (biggest >= 3) smothered.push(p.split('\n')[0].trim().slice(0, 60));
  }

  return {
    문장수: sentences.length,
    문장길이편차: +cv(sentences.map((s) => s.length)).toFixed(2),
    문단길이편차: +cv(paras.map((p) => p.length)).toFixed(2),
    굵게: per1k((body.match(/\*\*[^*]+\*\*/g) || []).length),
    줄표: per1k((body.match(/—/g) || []).length),
    사람흔적: (body.match(/저희|제가|저는|봤습니다|틀렸|지적받|못 ?봤|확신|죄송|같습니다/g) || []).length,
    구체: per1k((body.match(/\d/g) || []).length),
    접속어시작: (body.match(/(^|\n)\s*(또한|따라서|그러므로|즉|한편|아울러|이를 통해)/g) || []).length,
    표: tableInfo,
    뭉갠표: smothered,
  };
}

// 걸린 것만 말한다. 기준은 여러 문서를 놓고 눈으로 맞춘 값이다.
function smells(m, name) {
  const out = [];
  if (m.문장수 >= 12 && m.문장길이편차 < 0.35)
    out.push(`문장 길이가 너무 고릅니다 (편차 ${m.문장길이편차}). 짧은 문장을 섞어 주세요`);
  if (m.문단길이편차 < 0.45)
    out.push(`문단 길이가 너무 고릅니다 (편차 ${m.문단길이편차}). 한 줄짜리 문단도 있어야 합니다`);
  if (m.굵게 > 4)
    out.push(`굵게 표시가 잦습니다 (1000자당 ${m.굵게}번). 다 굵으면 아무것도 안 굵습니다`);
  if (m.줄표 > 1.5)
    out.push(`줄표(—)를 자주 씁니다 (1000자당 ${m.줄표}번). 사람은 이걸 잘 안 씁니다`);
  if (m.접속어시작 > 3)
    out.push(`'또한/따라서/즉' 으로 시작하는 문장이 ${m.접속어시작}개입니다`);
  if (m.사람흔적 === 0)
    out.push(`쓴 사람이 안 보입니다. 헷갈렸던 것, 틀렸던 것을 한 줄이라도 적어 주세요`);
  for (const t of m.표) {
    if (t.avgCell > 22)
      out.push(`표 칸이 깁니다 (평균 ${t.avgCell}자). 설명을 표에 접어 넣은 것이니 문장으로 펴세요\n      ${t.first}`);
  }
  return out;
}

const old = process.argv.includes('--old');
function read(rel) {
  if (!old) return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  try {
    return execFileSync('git', ['show', `HEAD~1:${rel}`], { cwd: ROOT, encoding: 'utf8' });
  } catch (e) { return null; }
}

console.log(old ? '고치기 전 (HEAD~1)\n' : '지금\n');
let total = 0;
let review = 0;
for (const rel of TARGETS) {
  const md = read(rel);
  if (md === null) { console.log(`  ${rel}: 그때는 없었음`); continue; }
  const m = measure(md);
  const s = smells(m, rel);
  total += s.length;
  if (s.length) {
    console.log(`✗ ${rel}`);
    for (const x of s) console.log(`    · ${x}`);
  } else {
    console.log(`✓ ${rel}`);
  }
  // 이건 걸린 것으로 세지 않는다. 기계가 판단할 수 없어서 사람이 가서 봐야 한다.
  for (const p of m.뭉갠표) {
    console.log(`    ? 표를 문장으로 편 자리인지 봐 주세요 — ${p}`);
    review++;
  }
  console.log(`    문장편차 ${m.문장길이편차} · 문단편차 ${m.문단길이편차} · 굵게 ${m.굵게}`
    + ` · 줄표 ${m.줄표} · 사람흔적 ${m.사람흔적} · 표 ${m.표.length}개\n`);
}
console.log(`걸린 것 ${total}건 · 눈으로 볼 것 ${review}건`);
